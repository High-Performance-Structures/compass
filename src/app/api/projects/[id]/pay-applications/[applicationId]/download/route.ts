import { decodeProjectRouteId } from "@/lib/project-route-id"
import { and, eq } from "drizzle-orm"
import { NextRequest } from "next/server"

import { getDb } from "@/db"
import {
  projectBudgetApplications,
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
import { canUseProjectAudience } from "@/lib/project-audience-access"
import { assertProjectAccess } from "@/lib/project-access"
import { isInternalStaffRole } from "@/lib/user-roles"

const DEFAULT_COMPASS_GOOGLE_DOWNLOAD_USER = "compass@hps-colorado.com"
const GOOGLE_NATIVE_MIME_PREFIX = "application/vnd.google-apps."

function environmentString(env: object, key: string): string | null {
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
      readonly applicationId: string
    }>
  }
): Promise<Response> {
  try {
    const user = await requireAuth()
    const { id: rawProjectId, applicationId } = await params
    const projectId = decodeProjectRouteId(rawProjectId)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const project = await assertProjectAccess(db, user, projectId)
    if (!project.organizationId) {
      return new Response("Pay application not found", { status: 404 })
    }

    if (!isInternalStaffRole(user.role)) {
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
      if (!canUseProjectAudience(membership?.role ?? null, "owner")) {
        return new Response("Pay application not found", { status: 404 })
      }
    }

    const [application] = await db
      .select({
        sourceRecordId: projectBudgetApplications.sourceRecordId,
        sourceSystem: projectBudgetApplications.sourceSystem,
        applicationNumber: projectBudgetApplications.applicationNumber,
      })
      .from(projectBudgetApplications)
      .where(
        and(
          eq(projectBudgetApplications.id, applicationId),
          eq(projectBudgetApplications.projectId, projectId),
          eq(projectBudgetApplications.ownerVisible, true)
        )
      )
      .limit(1)
    if (
      !application?.sourceRecordId ||
      application.sourceSystem !== "google_drive_g702_g703"
    ) {
      return new Response("Pay application document is unavailable", {
        status: 404,
      })
    }

    const [auth] = await db
      .select()
      .from(googleAuth)
      .where(eq(googleAuth.organizationId, project.organizationId))
      .limit(1)
    if (!auth) {
      return new Response("Document storage is unavailable", { status: 503 })
    }

    const encryptionKey =
      environmentString(env, "GOOGLE_SERVICE_ACCOUNT_ENCRYPTION_KEY") ??
      process.env.GOOGLE_SERVICE_ACCOUNT_ENCRYPTION_KEY
    if (!encryptionKey) {
      return new Response("Document storage is unavailable", { status: 503 })
    }

    const keyJson = await decrypt(
      auth.serviceAccountKeyEncrypted,
      encryptionKey,
      getGoogleCryptoSalt()
    )
    const client = new DriveClient({
      serviceAccountKey: parseServiceAccountKey(keyJson),
    })
    const googleEmail = downloadUserEmail(env)
    const file = await client.getFile(googleEmail, application.sourceRecordId)
    const isGoogleNative = file.mimeType.startsWith(GOOGLE_NATIVE_MIME_PREFIX)
    const response = isGoogleNative
      ? await client.exportFile(
          googleEmail,
          application.sourceRecordId,
          "application/pdf"
        )
      : await client.downloadFile(googleEmail, application.sourceRecordId)
    if (!response.ok) {
      console.error("Owner pay application download failed", {
        projectId,
        applicationId,
        status: response.status,
      })
      return new Response("Pay application could not be loaded", {
        status: response.status,
      })
    }

    const fallbackName = `Pay Application ${application.applicationNumber}.pdf`
    const sourceName = file.name.trim() || fallbackName
    const fileName = isGoogleNative ? `${sourceName}.pdf` : sourceName
    const download = request.nextUrl.searchParams.get("download") === "1"

    return new Response(response.body, {
      headers: {
        "Content-Type": isGoogleNative ? "application/pdf" : file.mimeType,
        "Content-Disposition":
          `${download ? "attachment" : "inline"}; ` +
          `filename="${safeFileName(fileName)}"`,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    console.error("Owner pay application download error", error)
    return new Response("Pay application could not be loaded", { status: 500 })
  }
}
