import { and, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm"
import { z } from "zod/v4"
import { correspondence, correspondenceAttachments, correspondenceDrafts, correspondenceSavedDrafts } from "@/db/schema-correspondence"
import { authorizedConversation, type CorrespondenceContext } from "./access"
import type { CompositionContent, CorrespondenceAttachment, ProjectDraft, SavedComposition } from "./types"

import { compositionHasContent } from "./draft-content"

const ids = z.array(z.string().min(1).max(200)).max(10).refine((value) => new Set(value).size === value.length)
const base = { subject: z.string().max(200), body: z.string().max(50000), attachmentIds: ids, requestId: z.string().regex(/^[a-zA-Z0-9_-]{16,100}$/).nullable() }
const contentSchema = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("message"), recipientUserIds: z.array(z.string().min(1).max(200)).max(30) }).strict(),
  z.object({ ...base, kind: z.literal("email"), to: z.array(z.email()).max(50), cc: z.array(z.email()).max(50), bcc: z.array(z.email()).max(50) }).strict().refine((value) => value.to.length + value.cc.length + value.bcc.length <= 50),
])
export function parseComposition(value: unknown): CompositionContent {
  const parsed = contentSchema.safeParse(value)
  if (!parsed.success) throw new Error("Check the draft's subject, recipients, text, and attachments.")
  return parsed.data
}
export async function draftAttachments(ctx: CorrespondenceContext, attachmentIds: readonly string[]): Promise<readonly CorrespondenceAttachment[]> {
  const rows = attachmentIds.length ? await ctx.db.select().from(correspondenceAttachments).where(and(inArray(correspondenceAttachments.id, [...attachmentIds]), eq(correspondenceAttachments.organizationId, ctx.organizationId), eq(correspondenceAttachments.projectId, ctx.projectId), eq(correspondenceAttachments.ownerUserId, ctx.user.id), isNull(correspondenceAttachments.messageId), isNull(correspondenceAttachments.retiredAt))) : []
  return attachmentIds.map((id) => {
    const row = rows.find((file) => file.id === id)
    return { id, name: row?.name ?? "Unavailable attachment — remove before sending", size: row?.size ?? 0, contentType: row?.contentType ?? "application/octet-stream", available: Boolean(row?.driveFileId) }
  })
}
export async function validateDraftAttachments(ctx: CorrespondenceContext, attachmentIds: readonly string[], kind: "message" | "email"): Promise<void> {
  if (!ids.safeParse(attachmentIds).success) throw new Error("Choose up to 10 distinct attachments.")
  const files = await draftAttachments(ctx, attachmentIds)
  if (files.some((file) => !file.available || file.size > 25 * 1024 * 1024) || files.reduce((n, file) => n + file.size, 0) > (kind === "email" ? 18 : 50) * 1024 * 1024) throw new Error("Review unavailable attachments and file size limits before saving.")
}
export async function listProjectDrafts(ctx: CorrespondenceContext): Promise<readonly ProjectDraft[]> {
  const drafts = await ctx.db.select().from(correspondenceSavedDrafts).where(and(eq(correspondenceSavedDrafts.organizationId, ctx.organizationId), eq(correspondenceSavedDrafts.projectId, ctx.projectId), eq(correspondenceSavedDrafts.userId, ctx.user.id), isNull(correspondenceSavedDrafts.retiredAt))).orderBy(desc(correspondenceSavedDrafts.updatedAt))
  const compositions: SavedComposition[] = []
  for (const row of drafts) {
    if (row.content.kind === "email" && ctx.workspace !== "staff" || !compositionHasContent(row.content)) continue
    compositions.push({ id: row.id, version: row.version, updatedAt: row.updatedAt, content: row.content, attachments: await draftAttachments(ctx, row.content.attachmentIds) })
  }
  const replies = await ctx.db.select({ draft: correspondenceDrafts, subject: correspondence.subject }).from(correspondenceDrafts).innerJoin(correspondence, eq(correspondence.id, correspondenceDrafts.conversationId)).where(and(eq(correspondenceDrafts.userId, ctx.user.id), eq(correspondence.projectId, ctx.projectId), eq(correspondence.organizationId, ctx.organizationId)))
  const result: ProjectDraft[] = [...compositions]
  for (const { draft, subject } of replies) {
    if (!draft.body.trim() && !draft.attachmentIds.length) continue
    try { await authorizedConversation(ctx, draft.conversationId) } catch { continue }
    result.push({ id: draft.id, kind: "reply", conversationId: draft.conversationId, subject, body: draft.body, updatedAt: draft.updatedAt, attachmentCount: draft.attachmentIds.length })
  }
  return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}
export function savedDraftGuard(ctx: CorrespondenceContext, draft: { readonly id: string; readonly version: number } | undefined, content: CompositionContent): SQL | undefined {
  // Bind the entire reserved composition. Only these files retain staging expiry.
  // SQLite trim defaults to spaces; match the composer's JavaScript trim.
  const trimCharacters = "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
  const bodyGuard = content.kind === "message" ? sql`trim(json_extract(content,'$.body'),${trimCharacters})=${content.body.trim()}` : sql`json_extract(content,'$.body')=${content.body}`
  const audienceGuard = content.kind === "message"
    ? sql`json_extract(content,'$.recipientUserIds')=${JSON.stringify(content.recipientUserIds)}`
    : sql`lower(json_extract(content,'$.to'))=${JSON.stringify(content.to)} AND lower(json_extract(content,'$.cc'))=${JSON.stringify(content.cc)} AND lower(json_extract(content,'$.bcc'))=${JSON.stringify(content.bcc)}`
  return draft ? sql`EXISTS(SELECT 1 FROM correspondence_saved_drafts WHERE id=${draft.id} AND organization_id=${ctx.organizationId} AND project_id=${ctx.projectId} AND user_id=${ctx.user.id} AND version=${draft.version} AND retired_at IS NULL AND json_extract(content,'$.requestId')=${content.requestId} AND json_extract(content,'$.kind')=${content.kind} AND json_extract(content,'$.attachmentIds')=${JSON.stringify(content.attachmentIds)} AND trim(json_extract(content,'$.subject'),${trimCharacters})=${content.subject.trim()} AND ${bodyGuard} AND ${audienceGuard})` : undefined
}
export function retireSentComposition(ctx: CorrespondenceContext, draft: { readonly id: string; readonly version: number }): ReturnType<typeof retireComposition> {
  return retireComposition(ctx, draft)
}
// Only a rejected request with no recorded send can unlock a reservation.
// The absence check races safely with the send batch's reservation guard.
export async function releaseRejectedComposition(ctx: CorrespondenceContext, draft: { readonly id: string; readonly version: number }, requestId: string, recordId: string, kind: "message" | "email" = "message"): Promise<number | null> {
  const absent = kind === "email" ? sql`NOT EXISTS(SELECT 1 FROM project_email_campaigns WHERE id=${recordId})` : sql`NOT EXISTS(SELECT 1 FROM correspondence_messages WHERE id=${recordId})`
  const rows = await ctx.db.update(correspondenceSavedDrafts).set({ content: sql`json_set(${correspondenceSavedDrafts.content}, '$.requestId', NULL)`, version: draft.version + 1 })
    .where(and(eq(correspondenceSavedDrafts.id, draft.id), eq(correspondenceSavedDrafts.organizationId, ctx.organizationId), eq(correspondenceSavedDrafts.projectId, ctx.projectId), eq(correspondenceSavedDrafts.userId, ctx.user.id), eq(correspondenceSavedDrafts.version, draft.version), isNull(correspondenceSavedDrafts.retiredAt), sql`json_extract(content,'$.requestId')=${requestId}`, sql`json_extract(content,'$.kind')=${kind}`, absent)).returning({ version: correspondenceSavedDrafts.version })
  return rows[0]?.version ?? null
}
function retireComposition(ctx: CorrespondenceContext, draft: { readonly id: string; readonly version: number }) {
  return ctx.db.update(correspondenceSavedDrafts).set({ retiredAt: new Date().toISOString(), version: sql`${correspondenceSavedDrafts.version}+1` }).where(and(eq(correspondenceSavedDrafts.id, draft.id), eq(correspondenceSavedDrafts.organizationId, ctx.organizationId), eq(correspondenceSavedDrafts.projectId, ctx.projectId), eq(correspondenceSavedDrafts.userId, ctx.user.id), eq(correspondenceSavedDrafts.version, draft.version), isNull(correspondenceSavedDrafts.retiredAt)))
}
