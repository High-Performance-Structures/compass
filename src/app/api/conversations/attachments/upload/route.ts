import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { NextRequest, NextResponse } from "next/server"

import { getDb } from "@/db"
import {
  channels,
  channelMembers,
  messageAttachments,
  messages,
} from "@/db/schema-conversations"
import { googleAuth } from "@/db/schema-google"
import { projectExternalLinks, projects } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { decrypt } from "@/lib/crypto"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { DriveClient } from "@/lib/google/client/drive-client"
import {
  getGoogleConfig,
  getGoogleCryptoSalt,
  parseServiceAccountKey,
} from "@/lib/google/config"
import { requireOrg } from "@/lib/org-scope"
import { requirePermission } from "@/lib/permissions"

const MAX_ATTACHMENT_COUNT = 10
const MAX_ATTACHMENT_FILE_BYTES = 25 * 1024 * 1024
const MAX_ATTACHMENT_BATCH_BYTES = 50 * 1024 * 1024
const CONVERSATION_FOLDER_NAME = "Compass Message Attachments"
const DEFAULT_COMPASS_GOOGLE_UPLOAD_USER = "compass@hps-colorado.com"
const GOOGLE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"

type AttachmentUploadResult =
  | {
      readonly success: true
      readonly attachments: readonly {
        readonly id: string
        readonly fileName: string
        readonly mimeType: string
        readonly fileSize: number
        readonly storageUrl: string
      }[]
    }
  | {
      readonly success: false
      readonly error: string
    }

function isFile(value: FormDataEntryValue): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    "name" in value &&
    "size" in value &&
    "type" in value
  )
}

function safeFileName(value: string): string {
  const normalized = value.replace(/[/:\\]/g, "-").trim()
  return normalized.length > 0 ? normalized : "message-attachment"
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

function driveFolderIdFromUrl(value: string | null): string | null {
  if (!value) return null
  const folderMatch = value.match(/\/folders\/([^/?#]+)/)
  if (folderMatch) return folderMatch[1] ?? null
  const idMatch = value.match(/[?&]id=([^&#]+)/)
  return idMatch?.[1] ?? null
}

function uploadEmail(
  userEmail: string,
  googleEmail: string | null,
  env: Record<string, string>
): string {
  const configured = env.COMPASS_GOOGLE_UPLOAD_USER?.trim()
  if (configured) return configured
  if (googleEmail) return googleEmail
  if (userEmail.endsWith("@hps-colorado.com")) return userEmail
  return DEFAULT_COMPASS_GOOGLE_UPLOAD_USER
}

async function findOrCreateAttachmentFolder(
  client: DriveClient,
  googleEmail: string,
  parentId: string,
  driveId: string | null
): Promise<string> {
  const result = await client.listFiles(googleEmail, {
    folderId: parentId,
    driveId: driveId ?? undefined,
    pageSize: 10,
    query:
      `mimeType = '${GOOGLE_FOLDER_MIME_TYPE}' and ` +
      `name = '${escapeDriveQueryValue(CONVERSATION_FOLDER_NAME)}'`,
  })
  const existing = result.files[0]
  if (existing) return existing.id

  const folder = await client.createFolder(googleEmail, {
    name: CONVERSATION_FOLDER_NAME,
    parentId,
    driveId: driveId ?? undefined,
  })
  return folder.id
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<AttachmentUploadResult>> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return NextResponse.json(
        { success: false, error: "Demo mode is read-only." },
        { status: 403 }
      )
    }
    requirePermission(user, "document", "create")
    const organizationId = requireOrg(user)
    const formData = await request.formData()
    const messageIdValue = formData.get("messageId")
    const messageId =
      typeof messageIdValue === "string" ? messageIdValue.trim() : ""
    const files = formData.getAll("files").filter(isFile)

    if (!messageId) {
      return NextResponse.json(
        { success: false, error: "Message ID is required." },
        { status: 400 }
      )
    }
    if (files.length === 0) {
      return NextResponse.json(
        { success: false, error: "Choose at least one file." },
        { status: 400 }
      )
    }
    if (files.length > MAX_ATTACHMENT_COUNT) {
      return NextResponse.json(
        {
          success: false,
          error: `Choose no more than ${MAX_ATTACHMENT_COUNT} files at once.`,
        },
        { status: 400 }
      )
    }
    const oversizedFile = files.find(
      (file) => file.size > MAX_ATTACHMENT_FILE_BYTES
    )
    if (oversizedFile) {
      return NextResponse.json(
        {
          success: false,
          error: `${oversizedFile.name} exceeds the 25 MB per-file limit.`,
        },
        { status: 400 }
      )
    }
    const batchBytes = files.reduce((total, file) => total + file.size, 0)
    if (batchBytes > MAX_ATTACHMENT_BATCH_BYTES) {
      return NextResponse.json(
        {
          success: false,
          error: "The selected files exceed the 50 MB batch limit.",
        },
        { status: 400 }
      )
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const message = await db
      .select({
        userId: messages.userId,
        channelId: messages.channelId,
        deletedAt: messages.deletedAt,
        projectId: channels.projectId,
        organizationId: channels.organizationId,
      })
      .from(messages)
      .innerJoin(channels, eq(channels.id, messages.channelId))
      .where(eq(messages.id, messageId))
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (
      !message ||
      message.organizationId !== organizationId ||
      message.deletedAt ||
      message.userId !== user.id
    ) {
      return NextResponse.json(
        { success: false, error: "Message not found." },
        { status: 404 }
      )
    }

    const membership = await db
      .select({ id: channelMembers.id })
      .from(channelMembers)
      .where(
        and(
          eq(channelMembers.channelId, message.channelId),
          eq(channelMembers.userId, user.id)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!membership) {
      return NextResponse.json(
        { success: false, error: "You do not have access to this channel." },
        { status: 403 }
      )
    }

    const auth = await db
      .select()
      .from(googleAuth)
      .where(eq(googleAuth.organizationId, organizationId))
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!auth) {
      return NextResponse.json(
        { success: false, error: "Google Drive is not connected." },
        { status: 400 }
      )
    }

    let parentId = auth.sharedDriveId
    if (message.projectId) {
      const project = await db
        .select({ googleDriveFolderId: projects.googleDriveFolderId })
        .from(projects)
        .where(
          and(
            eq(projects.id, message.projectId),
            eq(projects.organizationId, organizationId)
          )
        )
        .limit(1)
        .then((rows) => rows[0] ?? null)
      parentId = project?.googleDriveFolderId ?? null

      if (!parentId) {
        parentId = await db
          .select({
            externalId: projectExternalLinks.externalId,
            externalUrl: projectExternalLinks.externalUrl,
          })
          .from(projectExternalLinks)
          .where(
            and(
              eq(projectExternalLinks.projectId, message.projectId),
              eq(projectExternalLinks.system, "google_drive")
            )
          )
          .limit(1)
          .then((rows) => {
            const link = rows[0]
            return (
              link?.externalId ??
              driveFolderIdFromUrl(link?.externalUrl ?? null)
            )
          })
      }
    }
    if (!parentId) {
      return NextResponse.json(
        {
          success: false,
          error:
            "No Google Drive folder is available for message attachments.",
        },
        { status: 400 }
      )
    }

    const envRecord = env as unknown as Record<string, string>
    const config = getGoogleConfig(envRecord)
    const keyJson = await decrypt(
      auth.serviceAccountKeyEncrypted,
      config.encryptionKey,
      getGoogleCryptoSalt()
    )
    const client = new DriveClient({
      serviceAccountKey: parseServiceAccountKey(keyJson),
    })
    const googleEmail = uploadEmail(user.email, user.googleEmail, envRecord)
    const folderId = await findOrCreateAttachmentFolder(
      client,
      googleEmail,
      parentId,
      auth.sharedDriveId
    )
    const uploadedAt = new Date().toISOString()
    const attachments: Array<{
      readonly id: string
      readonly fileName: string
      readonly mimeType: string
      readonly fileSize: number
      readonly storageUrl: string
    }> = []

    for (const file of files) {
      const mimeType = file.type || "application/octet-stream"
      const driveFile = await client.uploadFile(googleEmail, {
        name: safeFileName(file.name),
        mimeType,
        parentId: folderId,
        driveId: auth.sharedDriveId ?? undefined,
        data: file,
      })
      const id = crypto.randomUUID()
      const storageUrl = `/api/google/download/${driveFile.id}`
      const fileSize = Number(driveFile.size ?? file.size)
      await db.insert(messageAttachments).values({
        id,
        messageId,
        fileName: driveFile.name,
        mimeType: driveFile.mimeType || mimeType,
        fileSize,
        r2Path: storageUrl,
        width: null,
        height: null,
        uploadedAt,
      })
      attachments.push({
        id,
        fileName: driveFile.name,
        mimeType: driveFile.mimeType || mimeType,
        fileSize,
        storageUrl,
      })
    }

    revalidatePath("/dashboard/conversations")
    revalidatePath(`/dashboard/conversations/${message.channelId}`)
    return NextResponse.json({ success: true, attachments })
  } catch (error) {
    console.error("Message attachment upload failed", error)
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to upload message attachments.",
      },
      { status: 500 }
    )
  }
}
