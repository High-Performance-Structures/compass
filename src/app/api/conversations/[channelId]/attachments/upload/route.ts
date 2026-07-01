import { and, eq } from "drizzle-orm"
import { NextRequest, NextResponse } from "next/server"

import { getDb } from "@/db"
import { projectExternalLinks, projects } from "@/db/schema"
import { googleAuth } from "@/db/schema-google"
import { channels, channelMembers } from "@/db/schema-conversations"
import { requireAuth } from "@/lib/auth"
import { decrypt } from "@/lib/crypto"
import { getCloudflareContext } from "@/lib/db"
import { DriveClient } from "@/lib/google/client/drive-client"
import {
  getGoogleConfig,
  getGoogleCryptoSalt,
  parseServiceAccountKey,
} from "@/lib/google/config"
import { requireOrg } from "@/lib/org-scope"
import { isDemoUser } from "@/lib/demo"

const GOOGLE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"
const MESSAGE_ATTACHMENT_FOLDER_NAME = "Compass Message Attachments"
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024
const DEFAULT_COMPASS_GOOGLE_UPLOAD_USER = "compass@hps-colorado.com"

type AttachmentUploadItem = {
  readonly fileName: string
  readonly mimeType: string
  readonly fileSize: number
  readonly driveFileId: string
  readonly driveUrl: string | null
  readonly downloadUrl: string
}

type AttachmentUploadResult =
  | {
      readonly success: true
      readonly attachments: readonly AttachmentUploadItem[]
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
  return normalized.length > 0 ? normalized : "compass-message-attachment"
}

function driveFolderIdFromUrl(value: string | null): string | null {
  if (!value) return null

  const folderMatch = value.match(/\/folders\/([^/?#]+)/)
  if (folderMatch) return folderMatch[1] ?? null

  const idMatch = value.match(/[?&]id=([^&#]+)/)
  if (idMatch) return idMatch[1] ?? null

  return null
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

function envString(env: Record<string, string>, key: string): string | null {
  const value = env[key]
  return value && value.trim().length > 0 ? value : null
}

function resolveGoogleUploadEmail(input: {
  readonly userEmail: string
  readonly googleEmail: string | null
  readonly env: Record<string, string>
}): string {
  const configuredEmail = envString(input.env, "COMPASS_GOOGLE_UPLOAD_USER")
  if (configuredEmail) return configuredEmail
  if (input.googleEmail) return input.googleEmail
  if (input.userEmail.endsWith("@hps-colorado.com")) return input.userEmail
  return DEFAULT_COMPASS_GOOGLE_UPLOAD_USER
}

async function findOrCreateAttachmentFolder(input: {
  readonly client: DriveClient
  readonly googleEmail: string
  readonly parentFolderId: string
  readonly driveId: string | null
}): Promise<string> {
  const result = await input.client.listFiles(input.googleEmail, {
    folderId: input.parentFolderId,
    driveId: input.driveId ?? undefined,
    pageSize: 10,
    query:
      `mimeType = '${GOOGLE_FOLDER_MIME_TYPE}' and ` +
      `name = '${escapeDriveQueryValue(MESSAGE_ATTACHMENT_FOLDER_NAME)}'`,
  })
  const existingFolder = result.files[0]
  if (existingFolder) return existingFolder.id

  const folder = await input.client.createFolder(input.googleEmail, {
    name: MESSAGE_ATTACHMENT_FOLDER_NAME,
    parentId: input.parentFolderId,
    driveId: input.driveId ?? undefined,
  })
  return folder.id
}

async function resolveProjectDriveFolderId(input: {
  readonly db: ReturnType<typeof getDb>
  readonly projectId: string
  readonly projectDriveFolderId: string | null
}): Promise<string | null> {
  if (input.projectDriveFolderId) return input.projectDriveFolderId

  const [driveLink] = await input.db
    .select({
      externalId: projectExternalLinks.externalId,
      externalUrl: projectExternalLinks.externalUrl,
    })
    .from(projectExternalLinks)
    .where(
      and(
        eq(projectExternalLinks.projectId, input.projectId),
        eq(projectExternalLinks.system, "google_drive")
      )
    )
    .limit(1)

  return (
    driveLink?.externalId ??
    driveFolderIdFromUrl(driveLink?.externalUrl ?? null)
  )
}

export async function POST(
  request: NextRequest,
  { params }: { readonly params: Promise<{ readonly channelId: string }> }
): Promise<NextResponse<AttachmentUploadResult>> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return NextResponse.json(
        { success: false, error: "Demo mode is read-only." },
        { status: 403 }
      )
    }
    const organizationId = requireOrg(user)
    const { channelId } = await params

    const { env } = await getCloudflareContext()
    const envRecord = env as unknown as Record<string, string>
    const googleEmail = resolveGoogleUploadEmail({
      userEmail: user.email,
      googleEmail: user.googleEmail,
      env: envRecord,
    })
    const config = getGoogleConfig(envRecord)
    const db = getDb(env.DB)

    const [channel] = await db
      .select({
        id: channels.id,
        organizationId: channels.organizationId,
        projectId: channels.projectId,
      })
      .from(channels)
      .where(eq(channels.id, channelId))
      .limit(1)

    if (!channel || channel.organizationId !== organizationId) {
      return NextResponse.json(
        { success: false, error: "Conversation not found." },
        { status: 404 }
      )
    }

    const [membership] = await db
      .select({ id: channelMembers.id })
      .from(channelMembers)
      .where(
        and(
          eq(channelMembers.channelId, channelId),
          eq(channelMembers.userId, user.id)
        )
      )
      .limit(1)
    if (!membership) {
      return NextResponse.json(
        { success: false, error: "You are not a member of this conversation." },
        { status: 403 }
      )
    }

    const [auth] = await db.select().from(googleAuth).limit(1)
    if (!auth) {
      return NextResponse.json(
        { success: false, error: "Google Drive is not connected." },
        { status: 400 }
      )
    }

    const formData = await request.formData()
    const files = formData.getAll("files").filter(isFile)
    if (files.length === 0) {
      return NextResponse.json(
        { success: false, error: "Choose at least one file to attach." },
        { status: 400 }
      )
    }

    const invalidFile = files.find((file) => file.size > MAX_FILE_SIZE_BYTES)
    if (invalidFile) {
      return NextResponse.json(
        {
          success: false,
          error: `${invalidFile.name} is larger than 50 MB.`,
        },
        { status: 400 }
      )
    }

    const keyJson = await decrypt(
      auth.serviceAccountKeyEncrypted,
      config.encryptionKey,
      getGoogleCryptoSalt()
    )
    const client = new DriveClient({
      serviceAccountKey: parseServiceAccountKey(keyJson),
    })

    let parentFolderId = auth.sharedDriveId
    if (channel.projectId) {
      const [project] = await db
        .select({
          id: projects.id,
          googleDriveFolderId: projects.googleDriveFolderId,
        })
        .from(projects)
        .where(
          and(
            eq(projects.id, channel.projectId),
            eq(projects.organizationId, organizationId)
          )
        )
        .limit(1)
      parentFolderId =
        project
          ? await resolveProjectDriveFolderId({
              db,
              projectId: project.id,
              projectDriveFolderId: project.googleDriveFolderId,
            })
          : parentFolderId
    }

    if (!parentFolderId) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Map this project or organization to Google Drive before attaching files.",
        },
        { status: 400 }
      )
    }

    const targetFolderId = await findOrCreateAttachmentFolder({
      client,
      googleEmail,
      parentFolderId,
      driveId: auth.sharedDriveId,
    })

    const attachments: AttachmentUploadItem[] = []
    for (const file of files) {
      const driveFile = await client.uploadFile(googleEmail, {
        name: safeFileName(file.name),
        mimeType: file.type || "application/octet-stream",
        parentId: targetFolderId,
        driveId: auth.sharedDriveId ?? undefined,
        data: file,
      })
      attachments.push({
        fileName: driveFile.name,
        mimeType: driveFile.mimeType ?? file.type,
        fileSize: Number(driveFile.size ?? file.size),
        driveFileId: driveFile.id,
        driveUrl: driveFile.webViewLink ?? null,
        downloadUrl: `/api/google/download/${driveFile.id}`,
      })
    }

    return NextResponse.json({ success: true, attachments })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to upload attachments.",
      },
      { status: 500 }
    )
  }
}
