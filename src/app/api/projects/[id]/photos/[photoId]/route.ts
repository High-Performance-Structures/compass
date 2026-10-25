import { audienceReadCacheControl, assertAudienceResourceProject } from "@/lib/project-audience-request-server"
import { conversationRequestViewer } from "@/lib/conversations/preview-viewer"
import { resolveProjectRouteId } from "@/lib/project-route-id"
import { and, eq, or, sql } from "drizzle-orm"
import { NextRequest } from "next/server"

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
  getExportExtension,
  getExportMimeType,
  isGoogleNativeFile,
} from "@/lib/google/mapper"
import {
  canUseProjectAudience,
  type ProjectAudience,
} from "@/lib/project-audience-access"
import { assertOwnerUpdateReadAccess } from "@/lib/owner-updates/access"
import { assertProjectAccess } from "@/lib/project-access"
import { hasActiveExternalProjectResourceGrant } from "@/lib/project-external-resource-access"
import { isInternalStaffRole } from "@/lib/user-roles"

const DEFAULT_COMPASS_GOOGLE_DOWNLOAD_USER = "compass@hps-colorado.com"

function audienceValue(value: string | null): ProjectAudience | null {
  if (value === "owner" || value === "sub_vendor") return value
  return null
}

function resourceTypeValue(
  value: string | null
): "photo" | "owner_update_document" {
  return value === "owner_update_document" ? "owner_update_document" : "photo"
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

function externalResponseMimeType(value: string | null): string {
  switch (value) {
    case "image/jpeg":
    case "image/png":
    case "image/gif":
    case "image/webp":
    case "application/pdf":
    case "text/plain":
      return value
    default:
      return "application/octet-stream"
  }
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
    const user = await conversationRequestViewer(await requireAuth())
    if (!user) return new Response("Not found", { status: 404 })
    const db = await assertOwnerUpdateReadAccess(user)
    const { id: rawProjectId, photoId } = await params
    const projectId = await resolveProjectRouteId(rawProjectId)
    if (!projectId) return new Response("Photo not found", { status: 404 })
    const audience = audienceValue(request.nextUrl.searchParams.get("audience"))
    await assertAudienceResourceProject(projectId)
    const resourceType = resourceTypeValue(
      request.nextUrl.searchParams.get("resourceType")
    )
    const viewerIsInternal =
      user.organizationType === "internal" && isInternalStaffRole(user.role)
    let projectOrganizationId = user.organizationId

    if (viewerIsInternal) {
      const project = await assertProjectAccess(db, user, projectId)
      projectOrganizationId = project.organizationId
    }
    if (!viewerIsInternal) {
      if (audience === null || projectOrganizationId === null) {
        return new Response("Photo not found", { status: 404 })
      }
      const granted = await hasActiveExternalProjectResourceGrant({
        db,
        organizationId: projectOrganizationId,
        projectId,
        recipientUserId: user.id,
        resourceId: photoId,
        resourceType,
        audience,
      })
      if (!granted) return new Response("Photo not found", { status: 404 })

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
              visibility,
              resourceType === "owner_update_document"
                ? sql<boolean>`(
                    (${dailyLogPhotos.mimeType} IS NULL AND ${dailyLogPhotos.thumbnailUrl} IS NULL)
                    OR ${dailyLogPhotos.mimeType} NOT LIKE 'image/%'
                  )`
                : sql<boolean>`(
                    ${dailyLogPhotos.mimeType} LIKE 'image/%'
                    OR (${dailyLogPhotos.mimeType} IS NULL AND ${dailyLogPhotos.thumbnailUrl} IS NOT NULL)
                  )`,
            )
      )
      .limit(1)
    if (
      !photo?.driveFileId ||
      (photo.mimeType === null && viewerIsInternal)
    ) {
      return new Response("Photo not found", { status: 404 })
    }

    if (projectOrganizationId === null) {
      return new Response("Photo not found", { status: 404 })
    }
    const { env } = await getCloudflareContext()

    const [auth] = await db
      .select()
      .from(googleAuth)
      .where(eq(googleAuth.organizationId, projectOrganizationId))
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
    const exportMimeType =
      photo.mimeType !== null && isGoogleNativeFile(photo.mimeType)
      ? getExportMimeType(photo.mimeType)
      : null
    if (
      photo.mimeType !== null &&
      isGoogleNativeFile(photo.mimeType) &&
      exportMimeType === null
    ) {
      return new Response("This Google file type cannot be downloaded", {
        status: 415,
      })
    }
    const response =
      exportMimeType === null
        ? await client.downloadFile(googleEmail, photo.driveFileId)
        : await client.exportFile(
            googleEmail,
            photo.driveFileId,
            exportMimeType
          )
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

    const storedResponseMimeType = exportMimeType ?? photo.mimeType
    const responseMimeType = viewerIsInternal
      ? storedResponseMimeType ?? "application/octet-stream"
      : externalResponseMimeType(storedResponseMimeType)
    const responseFileName = viewerIsInternal
      ? exportMimeType === null || photo.mimeType === null
        ? photo.fileName
        : `${photo.fileName.replace(/\.[^.]+$/, "")}${getExportExtension(photo.mimeType)}`
      : resourceType === "photo"
        ? "shared-photo"
        : "project-file"

    return new Response(response.body, {
      headers: {
        "Content-Type": responseMimeType,
        "Content-Disposition": `${responseMimeType.startsWith("image/") ? "inline" : "attachment"}; filename="${safeFileName(responseFileName)}"`,
        "Cache-Control": await audienceReadCacheControl(),
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    if (error instanceof Error && (error.message === "Project not found" || error.message === "Record not found.")) {
      return new Response("Photo not found", { status: 404 })
    }
    console.error("Audience photo download error", error)
    return new Response("Photo could not be loaded", { status: 500 })
  }
}
