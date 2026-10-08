"use server"
import { and, eq, isNull } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { correspondenceSavedDrafts } from "@/db/schema-correspondence"
import { correspondenceContext } from "@/lib/correspondence/access"
import { draftAttachments, listProjectDrafts, parseComposition, validateDraftAttachments } from "@/lib/correspondence/saved-drafts"
import type { CorrespondenceResult, ProjectDraft, SavedComposition } from "@/lib/correspondence/types"

function failure(error: unknown): { readonly success: false; readonly error: string } {
  return { success: false, error: error instanceof Error && !/SQL|sqlite|constraint|query|D1|database|syntax/i.test(error.message) ? error.message : "The draft could not be saved. Keep this page open and try again." }
}
export async function getProjectDrafts(projectId: string): Promise<CorrespondenceResult<readonly ProjectDraft[]>> {
  try { return { success: true, data: await listProjectDrafts(await correspondenceContext(projectId)) } } catch (error) { return failure(error) }
}
export async function saveProjectComposition(projectId: string, id: string, expectedVersion: number, input: unknown): Promise<CorrespondenceResult<SavedComposition>> {
  try {
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new Error("Invalid draft.")
    const content = parseComposition(input)
    const ctx = await correspondenceContext(projectId)
    if (content.kind === "email" && ctx.workspace !== "staff") throw new Error("Only project staff can compose email.")
    await validateDraftAttachments(ctx, content.attachmentIds, content.kind)
    const owned = and(eq(correspondenceSavedDrafts.id, id), eq(correspondenceSavedDrafts.organizationId, ctx.organizationId), eq(correspondenceSavedDrafts.projectId, projectId), eq(correspondenceSavedDrafts.userId, ctx.user.id), isNull(correspondenceSavedDrafts.retiredAt))
    const previous = await ctx.db.select().from(correspondenceSavedDrafts).where(owned).get()
    // A send reserved this exact content. Never allow autosave to change an uncertain request.
    if (previous?.content.requestId && JSON.stringify(previous.content) !== JSON.stringify(content)) throw new Error("This draft has a pending send. Resolve that same send before editing.")
    const values = { content, version: expectedVersion + 1, updatedAt: new Date().toISOString() }
    const rows = expectedVersion === 0
      ? await ctx.db.insert(correspondenceSavedDrafts).values({ id, organizationId: ctx.organizationId, projectId, userId: ctx.user.id, ...values }).onConflictDoNothing().returning()
      : await ctx.db.update(correspondenceSavedDrafts).set(values).where(and(owned, eq(correspondenceSavedDrafts.version, expectedVersion))).returning()
    const row = rows[0]
    if (!row) throw new Error("This draft changed on another device. Keep your text here and reload before retrying.")
    revalidatePath(`/dashboard/projects/${projectId}/messages`)
    return { success: true, data: { id, ...values, attachments: await draftAttachments(ctx, content.attachmentIds) } }
  } catch (error) { return failure(error) }
}
export async function setProjectDraftDiscarded(projectId: string, id: string, expectedVersion: number, discarded: boolean): Promise<CorrespondenceResult<{ readonly version: number }>> {
  try {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || typeof discarded !== "boolean") throw new Error("Invalid draft.")
    const ctx = await correspondenceContext(projectId)
    const version = expectedVersion + 1
    const rows = await ctx.db.update(correspondenceSavedDrafts).set({ retiredAt: discarded ? new Date().toISOString() : null, version }).where(and(eq(correspondenceSavedDrafts.id, id), eq(correspondenceSavedDrafts.organizationId, ctx.organizationId), eq(correspondenceSavedDrafts.projectId, projectId), eq(correspondenceSavedDrafts.userId, ctx.user.id), eq(correspondenceSavedDrafts.version, expectedVersion))).returning({ version: correspondenceSavedDrafts.version })
    if (!rows.length) throw new Error("This draft changed on another device. Reload before discarding.")
    revalidatePath(`/dashboard/projects/${projectId}/messages`)
    return { success: true, data: { version } }
  } catch (error) { return failure(error) }
}
