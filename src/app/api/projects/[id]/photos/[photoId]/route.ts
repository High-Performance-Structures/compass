import { and, eq, or } from "drizzle-orm"
import { NextRequest } from "next/server"

import { getDb } from "@/db"
import {
  dailyLogPhotos,
  projectMembers,
} from "@/db/schema"
import { googleAuth } from "@/db/schema-google"
import { requireAuth } from "@/lib/auth"
import { decrypt } from "@/lib/crypto"
import { getCloudflareContext } from "@/lib/db"
import { DriveClient } from "@/lib/google/client/drive-client"
import {
  getGoogleCryptoSalt,
  parseServiceAccountKey,
} from "@/lib/google/config"
import {
  canUseProjectAudience,
  type ProjectAudience,
} from "@/lib/project-audience-access"
import { assertProjectAccess } from "@/lib/project-access"
import { isInternalStaffRole } from "@/lib/user-roles"

const DEFAULT_COMPASS_GOOGLE_DOWNLOAD_USER = "compass@hps-colorado.com"

function audienceValue(value: string | null): ProjectAudience | null {
  if (value === "owner" || value === "sub_vendor") return value
  return null
}

function environmentString(
  env: object,
  key: string
): string | null {
  const rawValue: unknown = Reflect.get(env, key)
  if (typeof rawValue !== "string") return null
  const value = rawValue.trim()
  return value.length > 0 ? value : null
}

function downloadUserEmail(env: object): string {
  return (
    environmentString(env, "COMPASS_GOOGLE_UPLOAD_USER") ??
    environmentString(env, "COMPASS_GOOGLE_DOWNLOAD_USER") ??
    DEFAULT_COMPASS_GOOGLE_DOWNLOAD_USER
  )
}

function safeFileName(value: string): string {
  return value.replace(/["\r\n]/g, "_")
}

export async function GET(
  request: NextRequest,
  {
    params,
  }: {
    readonly params: Promise<{
      readonly id: string
      readonly photoId: string
    }>
  }
): Promise<Response> {
  try {
    const user = await requireAuth()
    const { id: projectId, photoId } = await params
    const audience = audienceValue(request.nextUrl.searchParams.get("audience"))
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const project = await assertProjectAccess(db, user, projectId)
    if (!project.organizationId) {
      return new Response("Photo not found", { status: 404 })
    }

    const viewerIsInternal = isInternalStaffRole(user.role)
    if (!viewerIsInternal) {
      if (audience === null) {
        return new Response("Photo not found", { status: 404 })
      }
      const [membership] = await db
        .select({ role: projectMembers.role })
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, projectId),
            eq(projectMembers.userId, user.id)
          )
        )
        .limit(1)
      if (!canUseProjectAudience(membership?.role ?? null, audience)) {
        return new Response("Photo not found", { status: 404 })
      }
    }

    const visibility =
      audience === "owner"
        ? or(
            eq(dailyLogPhotos.ownerVisible, true),
            eq(dailyLogPhotos.publicShareable, true)
          )
        : or(
            eq(dailyLogPhotos.subVendorVisible, true),
            eq(dailyLogPhotos.publicShareable, true)
          )
    const [photo] = await db
      .select({
        driveFileId: dailyLogPhotos.driveFileId,
        fileName: dailyLogPhotos.fileName,
        mimeType: dailyLogPhotos.mimeType,
      })
      .from(dailyLogPhotos)
      .where(
        viewerIsInternal
          ? and(
              eq(dailyLogPhotos.id, photoId),
              eq(dailyLogPhotos.projectId, projectId)
            )
          : and(
              eq(dailyLogPhotos.id, photoId),
              eq(dailyLogPhotos.projectId, projectId),
              eq(dailyLogPhotos.reviewStatus, "approved"),
              visibility
            )
      )
      .limit(1)
    if (
      !photo?.driveFileId ||
      !photo.mimeType
    ) {
      return new Response("Photo not found", { status: 404 })
    }

    const [auth] = await db
      .select()
      .from(googleAuth)
      .where(eq(googleAuth.organizationId, project.organizationId))
      .limit(1)
    if (!auth) {
      return new Response("Photo storage is unavailable", { status: 503 })
    }

    const encryptionKey =
      environmentString(env, "GOOGLE_SERVICE_ACCOUNT_ENCRYPTION_KEY") ??
      process.env.GOOGLE_SERVICE_ACCOUNT_ENCRYPTION_KEY
    if (!encryptionKey) {
      return new Response("Photo storage is unavailable", { status: 503 })
    }
    const keyJson = await decrypt(
      auth.serviceAccountKeyEncrypted,
      encryptionKey,
      getGoogleCryptoSalt()
    )
    const serviceAccountKey = parseServiceAccountKey(keyJson)
    const client = new DriveClient({ serviceAccountKey })
    const googleEmail = downloadUserEmail(env)
    const response = await client.downloadFile(googleEmail, photo.driveFileId)
    if (!response.ok) {
      console.error("Audience photo download failed", {
        projectId,
        photoId,
        status: response.status,
      })
      return new Response("Photo could not be loaded", {
        status: response.status,
      })
    }

    return new Response(response.body, {
      headers: {
        "Content-Type": photo.mimeType,
        "Content-Disposition": `${photo.mimeType.startsWith("image/") ? "inline" : "attachment"}; filename="${safeFileName(photo.fileName)}"`,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    console.error("Audience photo download error", error)
    return new Response("Photo could not be loaded", { status: 500 })
  }
}
