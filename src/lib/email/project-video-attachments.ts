import "server-only"

import { and, eq } from "drizzle-orm"

import type { getDb } from "@/db"
import { projectExternalLinks, projects } from "@/db/schema"
import { googleAuth } from "@/db/schema-google"
import { decrypt } from "@/lib/crypto"
import type { InboundAttachment } from "@/lib/email/gmail-message-parser"
import { DriveClient } from "@/lib/google/client/drive-client"
import {
  getGoogleConfig,
  getGoogleCryptoSalt,
  parseServiceAccountKey,
} from "@/lib/google/config"
import { MAX_PHOTO_UPLOAD_FILE_BYTES } from "@/lib/photos/upload-limits"

const GOOGLE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"
const VIDEO_FOLDER_NAME = "Videos"
const DEFAULT_COMPASS_GOOGLE_UPLOAD_USER = "compass@hps-colorado.com"

type Db = ReturnType<typeof getDb>

export type StoredProjectVideoFile = {
  readonly driveFileId: string
  readonly driveUrl: string | null
  readonly fileName: string
  readonly fileSize: number
  readonly mimeType: string
}

export type ProjectVideoUploadSession = {
  readonly uploadUrl: string
}

async function driveClient(input: {
  readonly env: unknown
  readonly db: Db
  readonly organizationId: string
}): Promise<{
  readonly client: DriveClient
  readonly googleEmail: string
  readonly sharedDriveId: string | null
}> {
  const [auth] = await input.db
    .select()
    .from(googleAuth)
    .where(eq(googleAuth.organizationId, input.organizationId))
    .limit(1)
  if (!auth) throw new Error("Google Drive is not connected.")

  const config = getGoogleConfig(input.env)
  const keyJson = await decrypt(
    auth.serviceAccountKeyEncrypted,
    config.encryptionKey,
    getGoogleCryptoSalt()
  )
  return {
    client: new DriveClient({
      serviceAccountKey: parseServiceAccountKey(keyJson),
    }),
    googleEmail:
      envString(input.env, "COMPASS_GOOGLE_UPLOAD_USER") ??
      DEFAULT_COMPASS_GOOGLE_UPLOAD_USER,
    sharedDriveId: auth.sharedDriveId,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function envString(env: unknown, key: string): string | null {
  if (!isRecord(env)) return process.env[key] ?? null
  const value = env[key]
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : process.env[key] ?? null
}

function safeFileName(value: string): string {
  const normalized = value.replace(/[/:\\]/g, "-").trim()
  return normalized.length > 0 ? normalized : "project-video"
}

function driveFolderIdFromUrl(value: string | null): string | null {
  if (!value) return null
  return (
    value.match(/\/folders\/([^/?#]+)/)?.[1] ??
    value.match(/[?&]id=([^&#]+)/)?.[1] ??
    null
  )
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

async function projectFolder(input: {
  readonly db: Db
  readonly projectId: string
}): Promise<string> {
  const [project] = await input.db
    .select({ googleDriveFolderId: projects.googleDriveFolderId })
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1)
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
  const folderId =
    project?.googleDriveFolderId ??
    driveLink?.externalId ??
    driveFolderIdFromUrl(driveLink?.externalUrl ?? null)
  if (!folderId) {
    throw new Error("Map this project to Google Drive before submitting videos.")
  }
  return folderId
}

async function resolveVideoFolder(input: {
  readonly client: DriveClient
  readonly googleEmail: string
  readonly projectFolderId: string
  readonly sharedDriveId: string | null
}): Promise<string> {
  const result = await input.client.listFiles(input.googleEmail, {
    folderId: input.projectFolderId,
    driveId: input.sharedDriveId ?? undefined,
    pageSize: 10,
    query:
      `mimeType = '${GOOGLE_FOLDER_MIME_TYPE}' and ` +
      `name = '${escapeDriveQueryValue(VIDEO_FOLDER_NAME)}'`,
  })
  const existing = result.files[0]
  if (existing) return existing.id

  const folder = await input.client.createFolder(input.googleEmail, {
    name: VIDEO_FOLDER_NAME,
    parentId: input.projectFolderId,
    driveId: input.sharedDriveId ?? undefined,
  })
  return folder.id
}

export async function storeProjectVideoAttachment(input: {
  readonly env: unknown
  readonly db: Db
  readonly organizationId: string
  readonly projectId: string
  readonly attachment: InboundAttachment
}): Promise<StoredProjectVideoFile> {
  const data = input.attachment.data
  if (!data) throw new Error(`Video data is missing for ${input.attachment.fileName}.`)
  if (data.byteLength > MAX_PHOTO_UPLOAD_FILE_BYTES) {
    throw new Error(`${input.attachment.fileName} exceeds the 50 MB text-video limit.`)
  }

  const projectFolderId = await projectFolder({
    db: input.db,
    projectId: input.projectId,
  })
  const drive = await driveClient({
    env: input.env,
    db: input.db,
    organizationId: input.organizationId,
  })
  const videoFolderId = await resolveVideoFolder({
    client: drive.client,
    googleEmail: drive.googleEmail,
    projectFolderId,
    sharedDriveId: drive.sharedDriveId,
  })
  const fileName = safeFileName(input.attachment.fileName)
  const mimeType = input.attachment.mimeType.startsWith("video/")
    ? input.attachment.mimeType
    : "video/mp4"
  const file = await drive.client.uploadFile(drive.googleEmail, {
    name: fileName,
    mimeType,
    parentId: videoFolderId,
    driveId: drive.sharedDriveId ?? undefined,
    data: new Blob([data.slice().buffer], { type: mimeType }),
  })

  return {
    driveFileId: file.id,
    driveUrl: file.webViewLink ?? null,
    fileName: file.name,
    fileSize: Number(file.size ?? data.byteLength),
    mimeType: file.mimeType,
  }
}

export async function initiateProjectVideoWebsiteUpload(input: {
  readonly env: unknown
  readonly db: Db
  readonly organizationId: string
  readonly projectId: string
  readonly fileName: string
  readonly mimeType: string
  readonly fileSize: number
}): Promise<ProjectVideoUploadSession> {
  const projectFolderId = await projectFolder({
    db: input.db,
    projectId: input.projectId,
  })
  const drive = await driveClient({
    env: input.env,
    db: input.db,
    organizationId: input.organizationId,
  })
  const videoFolderId = await resolveVideoFolder({
    client: drive.client,
    googleEmail: drive.googleEmail,
    projectFolderId,
    sharedDriveId: drive.sharedDriveId,
  })
  const uploadUrl = await drive.client.initiateResumableUpload(
    drive.googleEmail,
    {
      name: safeFileName(input.fileName),
      mimeType: input.mimeType,
      parentId: videoFolderId,
      driveId: drive.sharedDriveId ?? undefined,
      size: input.fileSize,
    }
  )
  return { uploadUrl }
}

export async function verifyProjectVideoWebsiteUpload(input: {
  readonly env: unknown
  readonly db: Db
  readonly organizationId: string
  readonly projectId: string
  readonly driveFileId: string
}): Promise<StoredProjectVideoFile> {
  const projectFolderId = await projectFolder({
    db: input.db,
    projectId: input.projectId,
  })
  const drive = await driveClient({
    env: input.env,
    db: input.db,
    organizationId: input.organizationId,
  })
  const videoFolderId = await resolveVideoFolder({
    client: drive.client,
    googleEmail: drive.googleEmail,
    projectFolderId,
    sharedDriveId: drive.sharedDriveId,
  })
  const file = await drive.client.getFile(drive.googleEmail, input.driveFileId)
  if (file.trashed || !file.parents?.includes(videoFolderId)) {
    throw new Error("The uploaded video is not in this project's Videos folder.")
  }
  const fileSize = Number(file.size ?? 0)
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    throw new Error("Google Drive did not report a valid video size.")
  }
  return {
    driveFileId: file.id,
    driveUrl: file.webViewLink ?? null,
    fileName: file.name,
    fileSize,
    mimeType: file.mimeType,
  }
}

export async function downloadProjectVideoFile(input: {
  readonly env: unknown
  readonly db: Db
  readonly organizationId: string
  readonly driveFileId: string
  readonly range?: string
}): Promise<Response> {
  const drive = await driveClient(input)
  const response = await drive.client.downloadFile(
    drive.googleEmail,
    input.driveFileId,
    { range: input.range }
  )
  if (!response.ok) {
    throw new Error(`Could not download the staged video (${response.status}).`)
  }
  return response
}
