import { and, eq, isNull } from "drizzle-orm"

import { correspondenceAttachments, correspondenceMessages, correspondenceRecipients } from "@/db/schema-correspondence"
import { recordActivityEvent } from "@/lib/activity-log"
import { getOrganizationDriveContext } from "@/lib/google/organization-drive"
import type { DriveFile } from "@/lib/google/client/types"

import {
  authorizedConversation,
  correspondenceContext,
  currentParticipants,
  type CorrespondenceContext,
} from "./access"

const MAX_ATTACHMENT_FILE_BYTES = 25 * 1024 * 1024
const GOOGLE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"

export class CorrespondenceAttachmentError extends Error {
  readonly status: 400 | 403 | 404 | 413 | 503

  constructor(status: 400 | 403 | 404 | 413 | 503, message: string) {
    super(message)
    this.status = status
  }
}

export type StagedCorrespondenceAttachment = {
  readonly id: string
  readonly name: string
  readonly size: number
  readonly contentType: string
}

type RestrictedDriveFolder = {
  readonly id: string
  readonly userEmail: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function configuredString(environment: unknown, key: string): string | null {
  if (!isRecord(environment)) return null
  const value = environment[key]
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function safeFileName(value: string): string {
  const normalized = value.replace(/[/:\\]/g, "-").trim()
  return normalized.length > 0 ? normalized : "correspondence-attachment"
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function configuredFolderId(
  environment: unknown,
  organizationId: string
): string | null {
  const raw = configuredString(environment, "COMPASS_CORRESPONDENCE_STAGING_FOLDERS")
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const folderId = parsed[organizationId]
  return typeof folderId === "string" && folderId.trim().length > 0
    ? folderId.trim()
    : null
}

/**
 * The staging folder must have a dedicated private ACL. Project-folder
 * inheritance and shared-drive membership can otherwise expose unsent files.
 */
export function restrictedCorrespondenceDriveFolder(input: {
  readonly environment: unknown
  readonly organizationId: string
}): RestrictedDriveFolder | null {
  const id = configuredFolderId(input.environment, input.organizationId)
  const userEmail = configuredString(
    input.environment,
    "COMPASS_CORRESPONDENCE_DRIVE_USER"
  )
  if (!id || !userEmail || !isEmail(userEmail)) return null
  return { id, userEmail: userEmail.toLowerCase() }
}

export function isRestrictedCorrespondenceFolder(input: {
  readonly folder: DriveFile
  readonly expectedFolderId: string
  readonly dedicatedUserEmail: string
}): boolean {
  if (
    input.folder.id !== input.expectedFolderId ||
    input.folder.mimeType !== GOOGLE_FOLDER_MIME_TYPE ||
    input.folder.trashed === true ||
    input.folder.shared === true ||
    input.folder.driveId !== undefined ||
    input.folder.permissions === undefined ||
    input.folder.permissions.length === 0
  ) {
    return false
  }
  const expected = input.dedicatedUserEmail.toLowerCase()
  return input.folder.permissions.every(
    (permission) =>
      permission.type === "user" &&
      permission.emailAddress?.toLowerCase() === expected
  )
}

async function safeDriveContext(ctx: CorrespondenceContext): Promise<{
  readonly drive: Awaited<ReturnType<typeof getOrganizationDriveContext>>
  readonly folder: RestrictedDriveFolder
}> {
  const folder = restrictedCorrespondenceDriveFolder({
    environment: ctx.env,
    organizationId: ctx.organizationId,
  })
  if (!folder) {
    throw new CorrespondenceAttachmentError(
      503,
      "Correspondence attachment storage needs a private organization Drive folder."
    )
  }
  const drive = await getOrganizationDriveContext({
    db: ctx.db,
    environment: ctx.env,
    organizationId: ctx.organizationId,
    user: ctx.user,
  })
  const folderMetadata = await drive.client.getFile(folder.userEmail, folder.id)
  if (
    !isRestrictedCorrespondenceFolder({
      folder: folderMetadata,
      expectedFolderId: folder.id,
      dedicatedUserEmail: folder.userEmail,
    })
  ) {
    throw new CorrespondenceAttachmentError(
      503,
      "Correspondence attachment storage needs a private organization Drive folder."
    )
  }
  return { drive, folder }
}

function fileContentType(file: File): string {
  return file.type.trim() || "application/octet-stream"
}

function activityActor(ctx: CorrespondenceContext): {
  readonly id: string
  readonly email: string
  readonly displayName: string | null
  readonly firstName: string | null
  readonly lastName: string | null
  readonly role: string
} {
  return {
    id: ctx.user.id,
    email: ctx.user.email,
    displayName: ctx.user.displayName,
    firstName: ctx.user.firstName,
    lastName: ctx.user.lastName,
    role: ctx.user.role,
  }
}

export async function stageCorrespondenceAttachment(input: {
  readonly projectId: string
  readonly file: File
}): Promise<StagedCorrespondenceAttachment> {
  if (input.file.size > MAX_ATTACHMENT_FILE_BYTES) {
    throw new CorrespondenceAttachmentError(
      413,
      `${input.file.name} exceeds the 25 MB per-file limit.`
    )
  }
  const ctx = await correspondenceContext(input.projectId)
  const { drive, folder } = await safeDriveContext(ctx)
  const contentType = fileContentType(input.file)
  const uploaded = await drive.client.uploadFile(folder.userEmail, {
    name: safeFileName(input.file.name),
    mimeType: contentType,
    parentId: folder.id,
    data: input.file,
  })
  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  try {
    await ctx.db.insert(correspondenceAttachments).values({
      id,
      organizationId: ctx.organizationId,
      projectId: ctx.projectId,
      ownerUserId: ctx.user.id,
      messageId: null,
      name: uploaded.name || safeFileName(input.file.name),
      contentType: uploaded.mimeType || contentType,
      size: input.file.size,
      driveFileId: uploaded.id,
      retiredAt: null,
      createdAt,
    })
  } catch (error) {
    try {
      await drive.client.trashFile(folder.userEmail, uploaded.id)
    } catch (trashError) {
      console.error("Unable to recover an unlinked correspondence attachment", trashError)
    }
    throw error
  }
  await recordActivityEvent({
    db: ctx.db,
    organizationId: ctx.organizationId,
    projectId: ctx.projectId,
    actor: activityActor(ctx),
    category: "file",
    action: "correspondence.attachment_staged",
    entityType: "correspondence_attachment",
    entityId: id,
    summary: `Staged correspondence attachment ${uploaded.name || input.file.name}.`,
    metadata: { size: input.file.size },
    createdAt,
  })
  return {
    id,
    name: uploaded.name || safeFileName(input.file.name),
    size: input.file.size,
    contentType: uploaded.mimeType || contentType,
  }
}

type AttachmentRow = {
  readonly id: string
  readonly ownerUserId: string
  readonly messageId: string | null
  readonly name: string
  readonly contentType: string
  readonly size: number
  readonly driveFileId: string | null
  readonly retiredAt: string | null
  readonly conversationId: string | null
  readonly retractedAt: string | null
}

async function attachmentForProject(input: {
  readonly ctx: CorrespondenceContext
  readonly attachmentId: string
}): Promise<AttachmentRow | null> {
  return input.ctx.db
    .select({
      id: correspondenceAttachments.id,
      ownerUserId: correspondenceAttachments.ownerUserId,
      messageId: correspondenceAttachments.messageId,
      name: correspondenceAttachments.name,
      contentType: correspondenceAttachments.contentType,
      size: correspondenceAttachments.size,
      driveFileId: correspondenceAttachments.driveFileId,
      retiredAt: correspondenceAttachments.retiredAt,
      conversationId: correspondenceMessages.conversationId,
      retractedAt: correspondenceMessages.retractedAt,
    })
    .from(correspondenceAttachments)
    .leftJoin(
      correspondenceMessages,
      eq(correspondenceMessages.id, correspondenceAttachments.messageId)
    )
    .where(
      and(
        eq(correspondenceAttachments.id, input.attachmentId),
        eq(correspondenceAttachments.organizationId, input.ctx.organizationId),
        eq(correspondenceAttachments.projectId, input.ctx.projectId)
      )
    )
    .get()
    .then((row) => row ?? null)
}

async function assertAttachmentReadAccess(input: {
  readonly ctx: CorrespondenceContext
  readonly attachment: AttachmentRow
}): Promise<void> {
  if (input.attachment.messageId === null) {
    if (
      input.attachment.ownerUserId !== input.ctx.user.id ||
      input.attachment.retiredAt !== null
    ) {
      throw new CorrespondenceAttachmentError(404, "Attachment not found.")
    }
    return
  }
  if (
    input.attachment.retiredAt !== null ||
    input.attachment.retractedAt !== null ||
    input.attachment.conversationId === null
  ) {
    throw new CorrespondenceAttachmentError(404, "Attachment not found.")
  }
  await authorizedConversation(input.ctx, input.attachment.conversationId)
  const participants = await currentParticipants(
    input.ctx,
    input.attachment.conversationId
  )
  if (!participants.some((participant) => participant.userId === input.ctx.user.id)) {
    throw new CorrespondenceAttachmentError(404, "Attachment not found.")
  }
  const recipient = await input.ctx.db
    .select({ id: correspondenceRecipients.id })
    .from(correspondenceRecipients)
    .where(
      and(
        eq(correspondenceRecipients.messageId, input.attachment.messageId),
        eq(correspondenceRecipients.userId, input.ctx.user.id)
      )
    )
    .get()
  if (!recipient) {
    throw new CorrespondenceAttachmentError(404, "Attachment not found.")
  }
}

export async function downloadCorrespondenceAttachment(input: {
  readonly projectId: string
  readonly attachmentId: string
}): Promise<{
  readonly body: Response
  readonly name: string
  readonly contentType: string
}> {
  const ctx = await correspondenceContext(input.projectId)
  const attachment = await attachmentForProject({
    ctx,
    attachmentId: input.attachmentId,
  })
  if (!attachment || !attachment.driveFileId) {
    throw new CorrespondenceAttachmentError(404, "Attachment not found.")
  }
  await assertAttachmentReadAccess({ ctx, attachment })
  const { drive, folder } = await safeDriveContext(ctx)
  const file = await drive.client.getFile(folder.userEmail, attachment.driveFileId)
  if (file.trashed === true || !file.parents?.includes(folder.id)) {
    throw new CorrespondenceAttachmentError(404, "Attachment not found.")
  }
  const body = await drive.client.downloadFile(folder.userEmail, attachment.driveFileId)
  if (!body.ok) {
    throw new CorrespondenceAttachmentError(404, "Attachment not found.")
  }
  return { body, name: attachment.name, contentType: attachment.contentType }
}

export async function deleteStagedCorrespondenceAttachment(input: {
  readonly projectId: string
  readonly attachmentId: string
}): Promise<void> {
  const ctx = await correspondenceContext(input.projectId)
  const attachment = await attachmentForProject({
    ctx,
    attachmentId: input.attachmentId,
  })
  if (
    !attachment ||
    attachment.ownerUserId !== ctx.user.id ||
    attachment.messageId !== null
  ) {
    throw new CorrespondenceAttachmentError(404, "Attachment not found.")
  }
  const retiredAt = attachment.retiredAt ?? new Date().toISOString()
  if (attachment.retiredAt === null) {
    const claimed = await ctx.db
      .update(correspondenceAttachments)
      .set({ retiredAt })
      .where(
        and(
          eq(correspondenceAttachments.id, attachment.id),
          eq(correspondenceAttachments.organizationId, ctx.organizationId),
          eq(correspondenceAttachments.projectId, ctx.projectId),
          eq(correspondenceAttachments.ownerUserId, ctx.user.id),
          isNull(correspondenceAttachments.messageId),
          isNull(correspondenceAttachments.retiredAt)
        )
      )
      .returning({ id: correspondenceAttachments.id })
      .then((rows) => rows[0] ?? null)
    if (!claimed) {
      throw new CorrespondenceAttachmentError(404, "Attachment not found.")
    }
  }

  // Retirement is durable before this provider call. If Drive is unavailable,
  // the same owner can retry and the preserved locator makes trashing idempotent.
  const { drive, folder } = await safeDriveContext(ctx)
  if (attachment.driveFileId) {
    await drive.client.trashFile(folder.userEmail, attachment.driveFileId)
  }
  await recordActivityEvent({
    db: ctx.db,
    organizationId: ctx.organizationId,
    projectId: ctx.projectId,
    actor: activityActor(ctx),
    category: "file",
    action: "correspondence.staged_attachment_trashed",
    entityType: "correspondence_attachment",
    entityId: attachment.id,
    summary: `Trashed retired correspondence attachment ${attachment.name}.`,
    metadata: { size: attachment.size },
    createdAt: retiredAt,
  })
}
