import "server-only"

import { and, eq, inArray } from "drizzle-orm"

import type { getDb } from "@/db"
import {
  dailyLogPhotos,
  projectExternalLinks,
  projects,
} from "@/db/schema"
import { googleAuth } from "@/db/schema-google"
import { decrypt } from "@/lib/crypto"
import { chunkD1Values } from "@/lib/d1-query"
import { insertDailyLogPhoto } from "@/lib/domain/field/store"
import type { InboundCandidate } from "@/lib/email/gmail-message-parser"
import { DriveClient } from "@/lib/google/client/drive-client"
import {
  getGoogleConfig,
  getGoogleCryptoSalt,
  parseServiceAccountKey,
} from "@/lib/google/config"
import {
  MAX_PHOTO_UPLOAD_BATCH_BYTES,
  MAX_PHOTO_UPLOAD_FILE_BYTES,
} from "@/lib/photos/upload-limits"
import { envString } from "@/lib/shared/env"

const GOOGLE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"
const DEFAULT_PHOTO_FOLDER_NAME = "Pictures"
const DEFAULT_COMPASS_GOOGLE_UPLOAD_USER = "compass@hps-colorado.com"

type Db = ReturnType<typeof getDb>

function safeFileName(value: string): string {
  const normalized = value.replace(/[/:\\]/g, "-").trim()
  return normalized.length > 0 ? normalized : "email-attachment"
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

async function resolvePhotoFolder(input: {
  readonly db: Db
  readonly client: DriveClient
  readonly googleEmail: string
  readonly projectId: string
  readonly projectFolderId: string
  readonly sharedDriveId: string | null
}): Promise<string> {
  const [linkedFolder] = await input.db
    .select({
      externalId: projectExternalLinks.externalId,
      externalUrl: projectExternalLinks.externalUrl,
    })
    .from(projectExternalLinks)
    .where(
      and(
        eq(projectExternalLinks.projectId, input.projectId),
        eq(projectExternalLinks.system, "google_progress_photos_folder")
      )
    )
    .limit(1)
  const linkedFolderId =
    linkedFolder?.externalId ??
    driveFolderIdFromUrl(linkedFolder?.externalUrl ?? null)
  if (linkedFolderId) return linkedFolderId

  for (const name of [DEFAULT_PHOTO_FOLDER_NAME, "Photos"]) {
    const result = await input.client.listFiles(input.googleEmail, {
      folderId: input.projectFolderId,
      driveId: input.sharedDriveId ?? undefined,
      pageSize: 10,
      query:
        `mimeType = '${GOOGLE_FOLDER_MIME_TYPE}' and ` +
        `name = '${escapeDriveQueryValue(name)}'`,
    })
    const folder = result.files[0]
    if (folder) return folder.id
  }

  const folder = await input.client.createFolder(input.googleEmail, {
    name: DEFAULT_PHOTO_FOLDER_NAME,
    parentId: input.projectFolderId,
    driveId: input.sharedDriveId ?? undefined,
  })
  return folder.id
}

export async function storeDailyLogEmailAttachments(input: {
  readonly env: unknown
  readonly db: Db
  readonly organizationId: string
  readonly projectId: string
  readonly dailyLogId: string
  readonly candidate: InboundCandidate
  readonly now: string
  readonly sourceSystem?: string
  readonly idPrefix?: string
}): Promise<number> {
  if (input.candidate.attachments.length === 0) return 0

  const totalBytes = input.candidate.attachments.reduce(
    (total, attachment) => total + (attachment.data?.byteLength ?? 0),
    0
  )
  if (totalBytes > MAX_PHOTO_UPLOAD_BATCH_BYTES) {
    throw new Error("Email attachments exceed the 90 MB batch limit.")
  }
  const oversized = input.candidate.attachments.find(
    (attachment) =>
      (attachment.data?.byteLength ?? attachment.size ?? 0) >
      MAX_PHOTO_UPLOAD_FILE_BYTES
  )
  if (oversized) {
    throw new Error(`${oversized.fileName} exceeds the 50 MB file limit.`)
  }

  const [project] = await input.db
    .select({ googleDriveFolderId: projects.googleDriveFolderId })
    .from(projects)
    .where(
      and(
        eq(projects.id, input.projectId),
        eq(projects.organizationId, input.organizationId)
      )
    )
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
  const projectFolderId =
    project?.googleDriveFolderId ??
    driveLink?.externalId ??
    driveFolderIdFromUrl(driveLink?.externalUrl ?? null)
  if (!projectFolderId) {
    throw new Error("Map this project to Google Drive before emailing files.")
  }

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
  const client = new DriveClient({
    serviceAccountKey: parseServiceAccountKey(keyJson),
  })
  const googleEmail =
    envString(input.env, "COMPASS_GOOGLE_UPLOAD_USER") ??
    DEFAULT_COMPASS_GOOGLE_UPLOAD_USER
  const folderId = await resolvePhotoFolder({
    db: input.db,
    client,
    googleEmail,
    projectId: input.projectId,
    projectFolderId,
    sharedDriveId: auth.sharedDriveId,
  })

  const photoIdFor = (index: number): string =>
    `${input.idPrefix ?? "email"}-photo-${input.candidate.gmailMessageId}-${index + 1}`
  // One read for the files a retried message already stored.
  const existingPhotoIds = new Set(
    (
      await Promise.all(
        chunkD1Values(input.candidate.attachments.map((_, index) => photoIdFor(index))).map((ids) =>
          input.db
            .select({ id: dailyLogPhotos.id })
            .from(dailyLogPhotos)
            .where(inArray(dailyLogPhotos.id, ids))
        )
      )
    ).flat().map((row) => row.id)
  )

  let storedCount = 0
  // Sequential: each file is a Google Drive upload (rate-limited outside API).
  for (let index = 0; index < input.candidate.attachments.length; index += 1) {
    const attachment = input.candidate.attachments[index]
    if (!attachment) continue
    if (!attachment.data) {
      throw new Error(`Gmail did not return data for ${attachment.fileName}.`)
    }
    const photoId = photoIdFor(index)
    if (existingPhotoIds.has(photoId)) continue

    const mimeType = attachment.mimeType || "application/octet-stream"
    const fileName = safeFileName(attachment.fileName)
    const driveFile = await client.uploadFile(googleEmail, {
      name: fileName,
      mimeType,
      parentId: folderId,
      driveId: auth.sharedDriveId ?? undefined,
      data: new Blob([attachment.data.slice().buffer], { type: mimeType }),
    })
    await insertDailyLogPhoto(input.db, {
      id: photoId,
      projectId: input.projectId,
      dailyLogId: input.dailyLogId,
      uploadedBy: null,
      sourceSystem: input.sourceSystem ?? "email",
      sourceExternalId:
        `${input.candidate.gmailMessageId}:` +
        (attachment.attachmentId ?? String(index + 1)),
      fileName: driveFile.name,
      fileSize: Number(driveFile.size ?? attachment.data.byteLength),
      mimeType: driveFile.mimeType,
      driveFileId: driveFile.id,
      driveUrl: driveFile.webViewLink ?? null,
      thumbnailUrl: mimeType.startsWith("image/")
        ? `/api/google/download/${driveFile.id}`
        : null,
      caption: null,
      capturedAt: input.candidate.receivedAt,
      uploadStatus: "uploaded",
      reviewStatus: "needs_review",
      ownerVisible: false,
      subVendorVisible: false,
      publicShareable: false,
      photoKind: "progress",
      schedulePhaseOverride: null,
      sortOrder: index,
      createdAt: input.now,
      updatedAt: input.now,
    })
    storedCount += 1
  }

  return storedCount
}
