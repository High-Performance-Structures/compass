"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod/v4"

import { actionFailure, type ActionResult } from "@/lib/action-result"
import { recordActivityEvent } from "@/lib/activity-log"
import {
  resolveImportedParticipant,
  reviewPeopleSearch,
  reviewSuggestions,
  type ReviewDecision,
  type ReviewOutcome,
  type ReviewPerson,
  type SplitPieceOutcome,
} from "@/lib/domain/conversations/imported-participant-resolve"
import {
  listUnresolvedParticipants,
  REVIEW_SORT_IDS,
  type ImportedParticipantReviewRow,
} from "@/lib/domain/conversations/imported-participant-review"
import { parseRecordPageQuery, type RecordPage } from "@/lib/record-page"
import { orgContext } from "@/lib/server/action-context"
import { isInternalStaffRole } from "@/lib/user-roles"

/*
 * Contacts → Needs review: imported conversation participants the importer
 * could not resolve. Staff only. Resolving never shares a conversation, never
 * notifies and never emails; visibility stays the "Share with owner/vendor…"
 * decision on the conversation.
 */

const STAFF_ONLY = "Only staff can review imported participants."

/** One server page of the list. */
export async function getImportedParticipantReviewPage(raw: unknown): Promise<ActionResult<RecordPage<ImportedParticipantReviewRow>>> {
  try {
    const context = await orgContext()
    if (!context.success) return context
    const { db, user, organizationId } = context.data
    if (!isInternalStaffRole(user.role)) return actionFailure(STAFF_ONLY)
    const query = parseRecordPageQuery(raw, REVIEW_SORT_IDS)
    return { success: true, data: await listUnresolvedParticipants(db, organizationId, query) }
  } catch (error) {
    console.error("Failed to list imported participants for review", error)
    return actionFailure("Could not load participants that need review.")
  }
}

const rowIdInput = z.string().trim().min(1).max(200)

/**
 * People whose full name or email is exactly what the row (or a split line)
 * shows: offered first as "Suggested", a hint only.
 */
export async function getImportedParticipantSuggestions(rowId: string, text: string | null): Promise<ActionResult<readonly ReviewPerson[]>> {
  try {
    const id = rowIdInput.parse(rowId)
    const line = z.string().trim().max(300).nullable().parse(text)
    const context = await orgContext()
    if (!context.success) return context
    const { db, user, organizationId } = context.data
    if (!isInternalStaffRole(user.role)) return actionFailure(STAFF_ONLY)
    return await reviewSuggestions(db, organizationId, id, line || null)
  } catch (error) {
    console.error("Failed to load imported participant suggestions", error)
    return actionFailure("Could not load suggested people.")
  }
}

/** Anyone in the company directory by name, email or phone (server-side, bounded). */
export async function searchImportedParticipantPeople(rowId: string, search: string): Promise<ActionResult<readonly ReviewPerson[]>> {
  try {
    const id = rowIdInput.parse(rowId)
    const term = z.string().trim().max(100).parse(search)
    const context = await orgContext()
    if (!context.success) return context
    const { db, user, organizationId } = context.data
    if (!isInternalStaffRole(user.role)) return actionFailure(STAFF_ONLY)
    return await reviewPeopleSearch(db, organizationId, id, term)
  } catch (error) {
    console.error("Failed to search people for imported participant review", error)
    return actionFailure("Could not search people.")
  }
}

const decisionInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pick"), ref: z.string().trim().min(1).max(300) }),
  z.object({
    type: z.literal("split"),
    pieces: z.array(z.object({
      text: z.string().max(300),
      choice: z.discriminatedUnion("type", [
        z.object({ type: z.literal("person"), ref: z.string().trim().min(1).max(300) }),
        z.object({ type: z.literal("new") }),
      ]),
    })).min(1).max(30),
  }),
  z.object({ type: z.literal("leave") }),
])

const resolveInput = z.object({ rowId: rowIdInput, decision: decisionInput, apply: z.boolean() })

export type ImportedParticipantResolveResult = ActionResult<ReviewOutcome & { readonly pieces: readonly SplitPieceOutcome[] }>

const ACTIVITY: Readonly<Record<ReviewDecision["type"], string>> = {
  pick: "imported_participant.picked",
  split: "imported_participant.split",
  leave: "imported_participant.left_as_is",
}

function activitySummary(outcome: ReviewOutcome): string {
  const where = outcome.channelName ? ` in ${outcome.channelName}` : ""
  if (outcome.decision === "leave") return `Left imported participant "${outcome.literal}"${where} as is (no person).`
  return `Manually resolved imported participant "${outcome.literal}"${where} to ${outcome.people.join(", ")}. Conversation visibility unchanged.`
}

/**
 * Pick person / Split into people / Leave as is. `apply: false` checks a
 * split and returns what each name would become, without writing.
 */
export async function resolveImportedParticipantAction(raw: z.input<typeof resolveInput>): Promise<ImportedParticipantResolveResult> {
  try {
    const parsed = resolveInput.safeParse(raw)
    if (!parsed.success) return actionFailure("Choose how to resolve this participant.")
    const input = parsed.data
    const context = await orgContext({ feature: "project-contacts", action: "update", mutation: input.apply })
    if (!context.success) return context
    const { db, user, organizationId } = context.data
    if (!isInternalStaffRole(user.role)) return actionFailure(STAFF_ONLY)
    const result = await resolveImportedParticipant({
      db, organizationId, rowId: input.rowId, decision: input.decision, apply: input.apply, now: new Date().toISOString(),
    })
    if (!result.success || !input.apply || !result.data.changed) return result
    const outcome = result.data
    await recordActivityEvent({
      db,
      organizationId,
      projectId: outcome.projectId,
      actor: user,
      category: "conversation",
      action: ACTIVITY[outcome.decision],
      entityType: outcome.channelId ? "channel" : "project",
      entityId: outcome.channelId ?? outcome.projectId,
      summary: activitySummary(outcome),
      // A manual staff choice: who was picked (directory references) is kept with the actor.
      metadata: { decision: outcome.decision, manual: true, refs: outcome.refs, people: outcome.people.length, rows: outcome.rowsReviewed, stillStaffOnly: outcome.stillStaffOnly },
    })
    revalidatePath("/dashboard/contacts")
    revalidatePath(`/dashboard/projects/${outcome.projectId}/contacts`)
    if (outcome.channelId) revalidatePath(`/dashboard/conversations/${outcome.channelId}`)
    return result
  } catch (error) {
    console.error("Failed to resolve imported participant", error)
    return actionFailure("Could not save this review.")
  }
}
