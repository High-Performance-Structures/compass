/**
 * Replacing a selection that doesn't change in place (owner decisions
 * 2026-11-12, locks.ts):
 *
 * - "Replace installed item": the installed item must be replaced and a
 *   different product is chosen (required).
 * - "Owner changed selection after approval": approved (or signed) and not
 *   yet ordered or installed; the owner wants something else.
 * - "Owner changed selection after purchase": the selection was ordered.
 * - "Supplier couldn't fill": marked Unavailable after it was ordered.
 *
 * The old selection stays on record exactly as it was (its status, pick,
 * choices and history), and a NEW selection replaces it: the same room,
 * name, category, quantity and cost code, copies of the old selection's
 * choices (with their links and photos), and the new pick when there is
 * one. It starts hidden from the owner and outside any Selection Phase.
 * Compass writes no change order: the job's project manager (or the next
 * selection manager, else an administrator) gets a to-do, linked to both
 * selections, to write it on the change-order screens; the owner signs that
 * change order. Never while the selection is out for signature in a
 * Selection Phase.
 */
import { and, eq } from "drizzle-orm"

import { projectFinishSelections } from "@/db/schema"
import { projectSelectionChoices, projectSelectionLinks, projectSelectionPhotos } from "@/db/schema-selection-choices"
import { recordActivityEvents, type ActivityActor } from "@/lib/activity-log"
import { firstActiveAdmin } from "@/lib/domain/identity/reads"
import type { Db } from "@/lib/server/action-context"

import { copyChoicesToReplacementStatements } from "./choices-store"
import { selectionIsReplaced, selectionOutForSignature, signedSelectionIds } from "./lock-read"
import { REPLACEMENT_REASON_LABELS, replacementBlocker, replacementStartStatus } from "./locks"
import { selectionManagers } from "./selection-managers"
import { ensureSelectionTodo } from "./selection-todos"
import { SELECTION_REPLACEMENT_REASONS, type SelectionReplacementReason } from "./statuses"
import { insertReplacementSelectionStatement } from "./store"

export type ReplaceSelectionResult =
  | {
      readonly ok: true
      readonly selectionId: string
      /** The to-do to write its change order, or null when one is already open or it failed. */
      readonly todoId: string | null
      /** Set when the to-do couldn't be made (the replacement was). */
      readonly todoWarning: string | null
    }
  | { readonly ok: false; readonly error: string }

function failed(error: string): ReplaceSelectionResult {
  return { ok: false, error }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message)
}

export async function replaceLockedSelection(
  db: Db,
  input: {
    readonly projectId: string
    readonly organizationId: string
    readonly selectionId: string
    readonly reason: SelectionReplacementReason
    /** A choice of the old selection, other than its pick, to pick on the new one; required to replace an installed item. */
    readonly choiceId: string | null
    readonly note: string | null
    readonly actor: ActivityActor & { readonly id: string }
  },
): Promise<ReplaceSelectionResult> {
  const old = await db
    .select({
      id: projectFinishSelections.id,
      name: projectFinishSelections.name,
      roomName: projectFinishSelections.roomName,
      status: projectFinishSelections.status,
      costCode: projectFinishSelections.costCode,
      procurementReleasedAt: projectFinishSelections.procurementReleasedAt,
      ownerApproved: projectFinishSelections.ownerApproved,
    })
    .from(projectFinishSelections)
    .where(and(eq(projectFinishSelections.id, input.selectionId), eq(projectFinishSelections.projectId, input.projectId)))
    .get()
  if (!old) return failed("Selection not found.")
  const approved = old.ownerApproved || (await signedSelectionIds(db, input.projectId)).has(old.id)
  const blocker = replacementBlocker(old.status, await selectionIsReplaced(db, old.id), input.reason, {
    releasedFromOrder: old.procurementReleasedAt !== null,
    approved,
    outForSignature: await selectionOutForSignature(db, old.id),
  })
  if (blocker) return failed(blocker)

  const [choices, links, photos] = await Promise.all([
    db
      .select({ id: projectSelectionChoices.id, title: projectSelectionChoices.title, chosen: projectSelectionChoices.chosen, ownerPriceCents: projectSelectionChoices.ownerPriceCents })
      .from(projectSelectionChoices)
      .where(and(eq(projectSelectionChoices.selectionId, old.id), eq(projectSelectionChoices.projectId, input.projectId))),
    db
      .select({ id: projectSelectionLinks.id, choiceId: projectSelectionLinks.choiceId })
      .from(projectSelectionLinks)
      .where(and(eq(projectSelectionLinks.selectionId, old.id), eq(projectSelectionLinks.projectId, input.projectId))),
    db
      .select({ id: projectSelectionPhotos.id, choiceId: projectSelectionPhotos.choiceId })
      .from(projectSelectionPhotos)
      .where(and(eq(projectSelectionPhotos.selectionId, old.id), eq(projectSelectionPhotos.projectId, input.projectId))),
  ])
  const pick = input.choiceId ? choices.find((choice) => choice.id === input.choiceId) : undefined
  if (input.choiceId && !pick) return failed("Choose one of this selection's choices.")
  if (pick?.chosen) return failed("Choose a different product than the one already picked.")
  if (input.reason === "installed_replaced" && !pick) {
    return failed("Choose the different product that replaces the installed item. Add it as a choice first if it isn't listed.")
  }

  const now = new Date().toISOString()
  const newId = crypto.randomUUID()
  const label = REPLACEMENT_REASON_LABELS[input.reason]
  const note = input.note?.trim().slice(0, 500) || null
  const newChoiceIds = new Map(choices.map((choice) => [choice.id, crypto.randomUUID()]))
  const newPickId = pick ? (newChoiceIds.get(pick.id) ?? null) : null
  const statements = [
    insertReplacementSelectionStatement(db, {
      id: newId,
      projectId: input.projectId,
      replacesSelectionId: old.id,
      expected: old.status,
      reason: input.reason,
      status: replacementStartStatus(newPickId !== null),
      notes: note ? `${label}: ${note}` : label,
      now,
    }),
    ...copyChoicesToReplacementStatements(db, {
      projectId: input.projectId,
      fromSelectionId: old.id,
      toSelectionId: newId,
      choices: choices.flatMap((choice) => {
        const copy = newChoiceIds.get(choice.id)
        return copy ? [{ fromId: choice.id, newId: copy }] : []
      }),
      links: links.map((link) => ({ fromId: link.id, newId: crypto.randomUUID(), newChoiceId: link.choiceId ? (newChoiceIds.get(link.choiceId) ?? null) : null })),
      photos: photos.map((photo) => ({ fromId: photo.id, newId: crypto.randomUUID(), newChoiceId: photo.choiceId ? (newChoiceIds.get(photo.choiceId) ?? null) : null })),
      pick: newPickId ? { newChoiceId: newPickId, userId: input.actor.id, note: note ? `${label}: ${note}` : label } : null,
      now,
    }),
  ]
  try {
    const [first, ...rest] = statements
    const [inserted] = await db.batch([first, ...rest])
    // Nothing landed: the old selection's status changed, or it was replaced, since it was read.
    if (inserted.meta.changes !== 1) return failed("This selection changed while you were working. Refresh and try again.")
  } catch (error) {
    if (isUniqueViolation(error)) return failed("This selection was already replaced. Refresh to see the replacement.")
    throw error
  }

  // Staff write the change order on the change-order screens; a to-do asks
  // for it. The replacement is already saved: a failed to-do is reported, and
  // staff make it again from the replacement's drawer.
  let todoId: string | null = null
  let todoWarning: string | null = null
  try {
    todoId = await ensureReplacementTodo(db, { projectId: input.projectId, organizationId: input.organizationId, replacementId: newId, actorId: input.actor.id, now })
  } catch (error) {
    console.error("Replacement change-order to-do failed", error)
    todoWarning = "The replacement was made, but its change-order to-do wasn't. Use Create change-order to-do in its drawer."
  }

  await recordActivityEvents(db, [
    {
      organizationId: input.organizationId,
      projectId: input.projectId,
      actor: input.actor,
      category: "field",
      action: "selection_replaced",
      entityType: "project_finish_selection",
      entityId: old.id,
      summary: `${old.name} (${old.status}) was replaced by a new selection: ${label.toLocaleLowerCase()}${pick ? `, ${pick.title} chosen` : ""}.${todoId ? " A to-do to write its change order was made." : ""}`,
      metadata: { replacementSelectionId: newId, reason: input.reason, choiceId: pick?.id ?? null, todoId },
      createdAt: now,
    },
  ])
  return { ok: true, selectionId: newId, todoId, todoWarning }
}

/**
 * The replacement's to-do to write its change order, for the job's first
 * selection manager (project manager, else the next role in Settings), else
 * the company's first active administrator. Null when one is already open
 * or this selection replaces nothing.
 */
export async function ensureReplacementTodo(
  db: Db,
  input: {
    readonly projectId: string
    readonly organizationId: string
    readonly replacementId: string
    readonly actorId: string
    readonly now: string
  },
): Promise<string | null> {
  const replacement = await db
    .select({
      name: projectFinishSelections.name,
      replacesSelectionId: projectFinishSelections.replacesSelectionId,
      reason: projectFinishSelections.replacementReason,
      notes: projectFinishSelections.notes,
    })
    .from(projectFinishSelections)
    .where(and(eq(projectFinishSelections.id, input.replacementId), eq(projectFinishSelections.projectId, input.projectId)))
    .get()
  if (!replacement?.replacesSelectionId) return null
  const [old, pick] = await Promise.all([
    db
      .select({ name: projectFinishSelections.name, roomName: projectFinishSelections.roomName })
      .from(projectFinishSelections)
      .where(and(eq(projectFinishSelections.id, replacement.replacesSelectionId), eq(projectFinishSelections.projectId, input.projectId)))
      .get(),
    db
      .select({ title: projectSelectionChoices.title })
      .from(projectSelectionChoices)
      .where(and(eq(projectSelectionChoices.selectionId, input.replacementId), eq(projectSelectionChoices.chosen, true)))
      .get(),
  ])
  const managers = await selectionManagers(db, input.projectId)
  const assignee = managers[0]?.name ?? (await firstActiveAdmin(db, input.organizationId))?.name ?? null
  const reason = SELECTION_REPLACEMENT_REASONS.find((known) => known === replacement.reason)
  const label = reason ? REPLACEMENT_REASON_LABELS[reason] : "Replaced"
  const what = old ? `${old.roomName} · ${old.name}` : replacement.name
  // The replacement's notes start "<reason>: <staff note>".
  const note = replacement.notes?.startsWith(`${label}: `) ? replacement.notes.slice(label.length + 2) : null
  return ensureSelectionTodo(db, {
    projectId: input.projectId,
    selectionId: input.replacementId,
    selectionName: replacement.name,
    step: "replacement_change_order",
    actorId: input.actorId,
    now: input.now,
    assigneeName: assignee,
    replacedSelectionId: replacement.replacesSelectionId,
    description:
      `${label}: ${what} is replaced by a new selection` +
      (pick ? ` with ${pick.title}` : "") +
      ". Write the change order for it on the change-order screens (both selections are linked to this to-do)" +
      (note ? `. ${note}` : "."),
  })
}
