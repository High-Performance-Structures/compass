import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm"
import { correspondenceAttachments } from "@/db/schema-correspondence"
import type { CompassEmailAttachment } from "@/lib/email/mime-message"
import type { CorrespondenceContext } from "./access"
import { downloadCorrespondenceAttachment } from "./attachment-storage"
import { boundedAttachmentBytes, MAX_CORRESPONDENCE_ATTACHMENTS, MAX_PROJECT_EMAIL_ATTACHMENT_BYTES } from "./attachment-limits"

type Attachment = typeof correspondenceAttachments.$inferSelect

export async function validateProjectEmailAttachments(ctx: CorrespondenceContext, ids: readonly string[], retainedDraft = false): Promise<readonly Attachment[]> {
  if (!Array.isArray(ids) || ids.length > MAX_CORRESPONDENCE_ATTACHMENTS || ids.some((id) => typeof id !== "string" || id.length > 200) || new Set(ids).size !== ids.length) throw new Error("Choose no more than 10 distinct attachments.")
  const files = ids.length ? await ctx.db.select().from(correspondenceAttachments).where(and(inArray(correspondenceAttachments.id, [...ids]), eq(correspondenceAttachments.organizationId, ctx.organizationId), eq(correspondenceAttachments.projectId, ctx.projectId), eq(correspondenceAttachments.ownerUserId, ctx.user.id), isNull(correspondenceAttachments.messageId), isNull(correspondenceAttachments.retiredAt))) : []
  const expiry = new Date(Date.now() - 7 * 86400000).toISOString()
  if (files.length !== ids.length || files.some((file) => !file.driveFileId || file.createdAt < expiry && !retainedDraft || file.size < 0) || files.reduce((n, file) => n + file.size, 0) > MAX_PROJECT_EMAIL_ATTACHMENT_BYTES) throw new Error("An attachment is unavailable or exceeds the 18 MB email attachment limit.")
  return files
}

export function emailAttachmentGuard(ctx: CorrespondenceContext, ids: readonly string[]): SQL | undefined {
  return ids.length ? sql`(SELECT COUNT(*) FROM correspondence_attachments WHERE id IN (${sql.join(ids.map((id) => sql`${id}`), sql`,`)}) AND organization_id=${ctx.organizationId} AND project_id=${ctx.projectId} AND owner_user_id=${ctx.user.id} AND message_id IS NULL AND retired_at IS NULL AND drive_file_id IS NOT NULL)=${ids.length}` : undefined
}

export async function loadProjectEmailAttachments(ctx: CorrespondenceContext, messageId: string): Promise<readonly CompassEmailAttachment[]> {
  const files = await ctx.db.select().from(correspondenceAttachments).where(and(eq(correspondenceAttachments.organizationId, ctx.organizationId), eq(correspondenceAttachments.projectId, ctx.projectId), eq(correspondenceAttachments.messageId, messageId)))
  if (files.length > MAX_CORRESPONDENCE_ATTACHMENTS || files.some((file) => file.retiredAt !== null || !file.driveFileId)) throw new Error("An email attachment is unavailable.")
  const result: CompassEmailAttachment[] = []
  let remaining = MAX_PROJECT_EMAIL_ATTACHMENT_BYTES
  for (const file of files) {
    const downloaded = await downloadCorrespondenceAttachment({ projectId: ctx.projectId, attachmentId: file.id })
    const content = await boundedAttachmentBytes(downloaded.body, remaining)
    remaining -= content.byteLength
    result.push({ filename: file.name, contentType: file.contentType, content })
  }
  return result
}
