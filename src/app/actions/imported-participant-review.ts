"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod/v4"

import { actionFailure, type ActionResult } from "@/lib/action-result"
import { recordActivityEvent } from "@/lib/activity-log"
import {
  companySuggestions,
  resolveParticipantGroup,
  type CompanySuggestion,
  type GroupDecision,
  type GroupReviewOutcome,
} from "@/lib/domain/conversations/imported-participant-group-resolve"
import {
  reviewPeopleSearch,
  reviewSuggestions,
  type ReviewPerson,
} from "@/lib/domain/conversations/imported-participant-resolve"
import { runAutoResolve, type AutoResolveSummary } from "@/lib/domain/conversations/participant-auto-resolve"
import {
  listUnresolvedParticipants,
  REVIEW_SORT_IDS,
  type ImportedParticipantReviewRow,
} from "@/lib/domain/conversations/imported-participant-review"
import { parseRecordPageQuery, type RecordPage } from "@/lib/record-page"
import { orgContext } from "@/lib/server/action-context"
import { canManageUserAccessRole, isInternalStaffRole } from "@/lib/user-roles"

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
  z.object({ type: z.literal("vendor"), vendorId: z.string().trim().min(1).max(200) }),
])

const resolveInput = z.object({ rowId: rowIdInput, decision: decisionInput, apply: z.boolean() })

export type ImportedParticipantResolveResult = ActionResult<GroupReviewOutcome>

const ACTIVITY: Readonly<Record<GroupDecision["type"], string>> = {
  pick: "imported_participant.picked",
  split: "imported_participant.split",
  leave: "imported_participant.left_as_is",
  vendor: "imported_participant.added_to_vendor",
}

function activitySummary(outcome: GroupReviewOutcome): string {
  const where = outcome.projects === 1 ? "" : ` on ${outcome.projects} projects`
  const rows = `${outcome.rowsReviewed} imported message ${outcome.rowsReviewed === 1 ? "entry" : "entries"}`
  if (outcome.decision === "leave") return `Left imported participant "${outcome.literal}" as is (no person)${where}, ${rows}.`
  return `Manually resolved imported participant "${outcome.literal}" to ${outcome.people.join(", ")}${where}, ${rows}. Conversation visibility unchanged.`
}

/**
 * Pick person / Split into people / Leave as is / Add to a vendor, applied to
 * every unresolved row of the name or email (legal-hold projects excepted).
 * `apply: false` describes the outcome without writing.
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
    const result = await resolveParticipantGroup({
      db, organizationId, rowId: input.rowId, decision: input.decision, apply: input.apply, now: new Date().toISOString(),
    })
    if (!result.success || !input.apply || !result.data.changed) return result
    const outcome = result.data
    // One Activity record per decision, however many rows and projects it covered.
    await recordActivityEvent({
      db,
      organizationId,
      projectId: outcome.projectId,
      actor: user,
      category: "conversation",
      action: ACTIVITY[outcome.decision],
      entityType: outcome.projectId ? "project" : "organization",
      entityId: outcome.projectId ?? organizationId,
      summary: activitySummary(outcome),
      // A manual staff choice: who was picked (directory references) is kept with the actor.
      metadata: { decision: outcome.decision, manual: true, refs: outcome.refs, people: outcome.people.length, rows: outcome.rowsReviewed, projects: outcome.projects, legalHoldRows: outcome.legalHoldRows, stillStaffOnly: outcome.stillStaffOnly },
    })
    revalidatePath("/dashboard/contacts")
    if (outcome.projectId) revalidatePath(`/dashboard/projects/${outcome.projectId}/contacts`)
    return result
  } catch (error) {
    console.error("Failed to resolve imported participant", error)
    return actionFailure("Could not save this review.")
  }
}

/** Vendors an email's domain points to (same domain, or a name that reads like it): suggestions only. */
export async function getImportedParticipantCompanySuggestions(rowId: string): Promise<ActionResult<readonly CompanySuggestion[]>> {
  try {
    const id = rowIdInput.parse(rowId)
    const context = await orgContext()
    if (!context.success) return context
    const { db, user, organizationId } = context.data
    if (!isInternalStaffRole(user.role)) return actionFailure(STAFF_ONLY)
    return await companySuggestions(db, organizationId, id)
  } catch (error) {
    console.error("Failed to load company suggestions", error)
    return actionFailure("Could not load company suggestions.")
  }
}

/**
 * The automatic pass over every clearly matched name or email (admins).
 * `apply: false` previews what it would do; `apply: true` resolves them and
 * records one Activity summary for the run. Nothing is shared, notified or
 * emailed, and legal-hold projects are never changed.
 */
export async function runImportedParticipantAutoResolve(apply: boolean): Promise<ActionResult<AutoResolveSummary>> {
  try {
    const shouldApply = z.boolean().parse(apply)
    const context = await orgContext({ feature: "project-contacts", action: "update", mutation: shouldApply })
    if (!context.success) return context
    const { db, user, organizationId } = context.data
    if (!canManageUserAccessRole(user.role)) return actionFailure("Only admins can run automatic matching.")
    const summary = await runAutoResolve(db, { organizationId, apply: shouldApply, now: new Date().toISOString() })
    if (shouldApply && summary.resolved.rows > 0) {
      await recordActivityEvent({
        db, organizationId, actor: user, category: "conversation",
        action: "imported_participant.auto_resolved", entityType: "organization", entityId: organizationId,
        summary: `Automatically matched ${summary.resolved.identities} imported participants (${summary.resolved.rows} message entries on ${summary.resolved.groups} project groups). Conversation visibility unchanged.`,
        metadata: {
          identities: summary.resolved.identities, rows: summary.resolved.rows, groups: summary.resolved.groups,
          leftoverIdentities: summary.leftover.identities, leftoverRows: summary.leftover.rows, legalHoldRows: summary.legalHold.rows,
          byMatchType: Object.fromEntries(Object.entries(summary.byMatchType).map(([type, totals]) => [type, totals.rows])),
        },
      })
      revalidatePath("/dashboard/contacts")
    }
    return { success: true, data: summary }
  } catch (error) {
    console.error("Failed to run automatic participant matching", error)
    return actionFailure("Could not run automatic matching.")
  }
}
