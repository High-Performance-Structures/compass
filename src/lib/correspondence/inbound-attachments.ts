import "server-only"

import type { getDb } from "@/db"
import type { correspondenceAttachments } from "@/db/schema-correspondence"
import {
  MAX_CORRESPONDENCE_ATTACHMENTS,
  MAX_CORRESPONDENCE_FILE_BYTES,
} from "@/lib/correspondence/attachment-limits"
import {
  isRestrictedCorrespondenceFolder,
  restrictedCorrespondenceDriveFolder,
} from "@/lib/correspondence/attachment-storage"
import type { InboundAttachment } from "@/lib/email/gmail-message-parser"
import { getOrganizationDriveContext } from "@/lib/google/organization-drive"
import { safeFileName } from "@/lib/shared/text"

/**
 * Files on an email posted as a project message. They go to the same private
 * Drive folder as files attached in Compass, so the message's normal
 * recipient checks control who can open them.
 */

type AttachmentInsert = typeof correspondenceAttachments.$inferInsert

export type StoredInboundAttachments = {
  readonly rows: readonly AttachmentInsert[]
  /** Trashes the uploaded files when the message itself could not be saved. */
  readonly discard: () => Promise<void>
}

/** Null when the files can't be stored safely; the email then stays in review. */
export async function storeInboundMessageAttachments(input: {
  readonly db: ReturnType<typeof getDb>
  readonly env: unknown
  readonly organizationId: string
  readonly projectId: string
  readonly messageId: string
  /** Inbound files have no Compass uploader; a staff recipient owns them. */
  readonly ownerUserId: string
  readonly attachments: readonly InboundAttachment[]
  readonly now: string
}): Promise<StoredInboundAttachments | null> {
  if (input.attachments.length === 0) return { rows: [], discard: async () => {} }
  if (input.attachments.length > MAX_CORRESPONDENCE_ATTACHMENTS) return null
  if (input.attachments.some((file) => !file.data || file.data.byteLength > MAX_CORRESPONDENCE_FILE_BYTES)) return null
  const folder = restrictedCorrespondenceDriveFolder({ environment: input.env, organizationId: input.organizationId })
  if (!folder) return null
  const drive = await getOrganizationDriveContext({
    db: input.db,
    environment: input.env,
    organizationId: input.organizationId,
    user: { email: folder.userEmail, googleEmail: null },
  })
  const folderMetadata = await drive.client.getFile(folder.userEmail, folder.id)
  if (!isRestrictedCorrespondenceFolder({ folder: folderMetadata, expectedFolderId: folder.id, dedicatedUserEmail: folder.userEmail })) {
    return null
  }

  const uploadedIds: string[] = []
  const discard = async (): Promise<void> => {
    for (const fileId of uploadedIds) {
      try {
        await drive.client.trashFile(folder.userEmail, fileId)
      } catch (error) {
        console.error("Unable to remove an unsaved inbound message attachment", error)
      }
    }
  }
  const rows: AttachmentInsert[] = []
  try {
    // Sequential: each file is a Google Drive upload (rate-limited outside API).
    for (const [index, file] of input.attachments.entries()) {
      if (!file.data) {
        await discard()
        return null
      }
      const contentType = file.mimeType || "application/octet-stream"
      const uploaded = await drive.client.uploadFile(folder.userEmail, {
        name: safeFileName(file.fileName, "email-attachment"),
        mimeType: contentType,
        parentId: folder.id,
        data: new Blob([file.data.slice().buffer], { type: contentType }),
      })
      uploadedIds.push(uploaded.id)
      rows.push({
        id: `${input.messageId}-file-${index + 1}`,
        organizationId: input.organizationId,
        projectId: input.projectId,
        ownerUserId: input.ownerUserId,
        messageId: input.messageId,
        name: uploaded.name || safeFileName(file.fileName, "email-attachment"),
        contentType: uploaded.mimeType || contentType,
        size: file.data.byteLength,
        driveFileId: uploaded.id,
        retiredAt: null,
        createdAt: input.now,
      })
    }
  } catch (error) {
    await discard()
    throw error
  }
  return { rows, discard }
}
