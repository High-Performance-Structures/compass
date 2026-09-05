import { and, eq } from "drizzle-orm"
import { NextRequest } from "next/server"

import { getDb } from "@/db"
import {
  channels,
  messageAttachments,
  messages,
} from "@/db/schema-conversations"
import { projectExternalLinks, projects, users } from "@/db/schema"
import { googleAuth } from "@/db/schema-google"
import { getCurrentUser } from "@/lib/auth"
import { decrypt } from "@/lib/crypto"
import { getCloudflareContext } from "@/lib/db"
import { getGoogleConfig, getGoogleCryptoSalt, parseServiceAccountKey } from "@/lib/google/config"
import { DriveClient } from "@/lib/google/client/drive-client"
import { getExportExtension, getExportMimeType, isGoogleNativeFile } from "@/lib/google/mapper"
import { isDriveItemWithinProjectFolder } from "@/lib/google/project-folder-boundary"
import { getConversationChannelAccess } from "@/lib/conversations/channel-access"
import { assertProjectAccess } from "@/lib/project-access"
import { requireOrg } from "@/lib/org-scope"

function validDriveId(value: string): string | null {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : null
}

function storageDriveFileId(value: string): string | null {
  const providerReference = value.match(/^(?:drive|google-drive):([A-Za-z0-9_-]+)$/)
  if (providerReference?.[1]) return validDriveId(providerReference[1])
  const genericRouteMatch = value.match(/^\/api\/google\/download\/([^/?#]+)/)
  if (genericRouteMatch?.[1]) {
    return validDriveId(decodeURIComponent(genericRouteMatch[1]))
  }
  const fileUrlMatch = value.match(
    /^https:\/\/drive\.google\.com\/file\/d\/([^/?#]+)(?:\/view)?$/
  )
  if (fileUrlMatch?.[1]) return validDriveId(fileUrlMatch[1])
  const openUrlMatch = value.match(
    /^https:\/\/drive\.google\.com\/open\?id=([^&#]+)$/
  )
  if (openUrlMatch?.[1]) return validDriveId(openUrlMatch[1])
  return validDriveId(value)
}

function safeFileName(value: string): string {
  return value.replace(/["\r\n]/g, "_")
}

async function projectFolderId(
  db: ReturnType<typeof getDb>,
  projectId: string,
  folderId: string | null
): Promise<string | null> {
  if (folderId) return folderId
  const link = await db
    .select({ externalId: projectExternalLinks.externalId, externalUrl: projectExternalLinks.externalUrl })
    .from(projectExternalLinks)
    .where(
      and(
        eq(projectExternalLinks.projectId, projectId),
        eq(projectExternalLinks.system, "google_drive")
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (link?.externalId) return link.externalId
  const match = link?.externalUrl?.match(/\/folders\/([^/?#]+)/)
  return match?.[1] ?? null
}

export async function GET(
  _request: NextRequest,
  { params }: { readonly params: Promise<{ readonly attachmentId: string }> }
): Promise<Response> {
  try {
    const user = await getCurrentUser()
    if (!user) return new Response("Unauthorized", { status: 401 })
    if (!user.isActive) return new Response("Forbidden", { status: 403 })

    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const { attachmentId } = await params

    const attachment = await db
      .select({
        id: messageAttachments.id,
        fileName: messageAttachments.fileName,
        mimeType: messageAttachments.mimeType,
        r2Path: messageAttachments.r2Path,
        messageDeletedAt: messages.deletedAt,
        channelId: channels.id,
        channelOrganizationId: channels.organizationId,
        projectId: channels.projectId,
        projectOrganizationId: projects.organizationId,
        projectFolderId: projects.googleDriveFolderId,
      })
      .from(messageAttachments)
      .innerJoin(messages, eq(messages.id, messageAttachments.messageId))
      .innerJoin(channels, eq(channels.id, messages.channelId))
      .leftJoin(projects, eq(projects.id, channels.projectId))
      .where(eq(messageAttachments.id, attachmentId))
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (
      !attachment ||
      attachment.messageDeletedAt ||
      attachment.channelOrganizationId !== organizationId
    ) {
      return new Response("Attachment not found", { status: 404 })
    }

    const channel = await getConversationChannelAccess({
      db,
      user,
      channelId: attachment.channelId,
    })
    if (!channel) return new Response("Attachment not found", { status: 404 })

    let folderId: string | null = null
    if (attachment.projectId) {
      if (
        !attachment.projectOrganizationId ||
        attachment.projectOrganizationId !== organizationId ||
        attachment.projectOrganizationId !== attachment.channelOrganizationId
      ) {
        return new Response("Attachment not found", { status: 404 })
      }
      let projectAccess
      try {
        projectAccess = await assertProjectAccess(db, user, attachment.projectId)
      } catch {
        return new Response("Attachment not found", { status: 404 })
      }
      if (projectAccess.organizationId !== organizationId) {
        return new Response("Attachment not found", { status: 404 })
      }
      folderId = await projectFolderId(
        db,
        attachment.projectId,
        attachment.projectFolderId
      )
      if (!folderId) return new Response("Attachment not found", { status: 404 })
    }

    const driveFileId = storageDriveFileId(attachment.r2Path)
    if (!driveFileId) return new Response("Attachment not found", { status: 404 })

    const auth = await db
      .select({
        serviceAccountKeyEncrypted: googleAuth.serviceAccountKeyEncrypted,
        sharedDriveId: googleAuth.sharedDriveId,
        connectedByEmail: users.email,
        connectedByGoogleEmail: users.googleEmail,
      })
      .from(googleAuth)
      .innerJoin(users, eq(users.id, googleAuth.connectedBy))
      .where(eq(googleAuth.organizationId, organizationId))
      .get()
    if (!auth) return new Response("Attachment storage unavailable", { status: 503 })

    const config = getGoogleConfig(env)
    const keyJson = await decrypt(
      auth.serviceAccountKeyEncrypted,
      config.encryptionKey,
      getGoogleCryptoSalt()
    )
    const client = new DriveClient({
      serviceAccountKey: parseServiceAccountKey(keyJson),
    })
    const googleEmail = auth.connectedByGoogleEmail ?? auth.connectedByEmail
    const fileMeta = await client.getFile(googleEmail, driveFileId)
    if (fileMeta.trashed) return new Response("Attachment not found", { status: 404 })

    if (
      folderId &&
      !(await isDriveItemWithinProjectFolder({
        client,
        googleEmail,
        itemId: driveFileId,
        projectFolderId: folderId,
      }))
    ) {
      return new Response("Attachment not found", { status: 404 })
    }

    let response: Response
    let fileName = attachment.fileName
    let contentType = fileMeta.mimeType || attachment.mimeType
    if (isGoogleNativeFile(fileMeta.mimeType)) {
      const exportMime = getExportMimeType(fileMeta.mimeType)
      if (!exportMime) return new Response("Attachment type unavailable", { status: 415 })
      fileName = `${attachment.fileName.replace(/\.[^.]+$/, "")}${getExportExtension(fileMeta.mimeType)}`
      contentType = exportMime
      response = await client.exportFile(googleEmail, driveFileId, exportMime)
    } else {
      response = await client.downloadFile(googleEmail, driveFileId)
    }
    if (!response.ok) return new Response("Attachment unavailable", { status: response.status })

    return new Response(response.body, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(safeFileName(fileName))}"`,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    console.error("Conversation attachment download failed", error)
    return new Response("Attachment unavailable", { status: 500 })
  }
}
