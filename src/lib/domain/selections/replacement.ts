/**
 * Replacing a locked selection (owner decisions 2026-11-12, locks.ts):
 *
 * - "Replace installed item": the installed item must be replaced and a
 *   different product is chosen (required).
 * - "Owner changed selection after purchase": the selection was ordered and
 *   the owner wants something else; the new product may be chosen now or
 *   later.
 *
 * Either way the old selection stays on record exactly as it was (its
 * status, pick, choices and history), and a NEW selection replaces it: the
 * same room, name, category, quantity and cost code, copies of the old
 * selection's choices (with their links and photos), and the new pick when
 * there is one. It starts hidden from the owner and outside any Selection
 * Phase. Unless the company turned it off (Settings › Selections), a draft
 * change order is created for it the usual way (the owner signs that change
 * order), priced at the new pick's owner price when it has one; staff
 * complete it (removal, restocking, credit) before sending.
 */
import { and, eq } from "drizzle-orm"

import { projectFinishSelections } from "@/db/schema"
import { projectSelectionChoices, projectSelectionLinks, projectSelectionPhotos } from "@/db/schema-selection-choices"
import { recordActivityEvents } from "@/lib/activity-log"
import type { Db } from "@/lib/server/action-context"

import { copyChoicesToReplacementStatements } from "./choices-store"
import { selectionIsReplaced } from "./lock-read"
import { REPLACEMENT_REASON_LABELS, replacementBlocker, replacementStartStatus } from "./locks"
import { readProjectSelectionSettings } from "./project-settings"
import { createSelectionChangeOrder, type SelectionChangeOrderActor } from "./selection-change-orders"
import type { SelectionReplacementReason } from "./statuses"
import { insertReplacementSelectionStatement } from "./store"

export type ReplaceSelectionResult =
  | {
      readonly ok: true
      readonly selectionId: string
      /** The draft change order, or null when it could not be created (the replacement stands). */
      readonly changeOrder: { readonly id: string; readonly number: string } | null
      readonly changeOrderError: string | null
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
    readonly actor: SelectionChangeOrderActor
  },
): Promise<ReplaceSelectionResult> {
  const old = await db
    .select({
      id: projectFinishSelections.id,
      name: projectFinishSelections.name,
      roomName: projectFinishSelections.roomName,
      status: projectFinishSelections.status,
      costCode: projectFinishSelections.costCode,
    })
    .from(projectFinishSelections)
    .where(and(eq(projectFinishSelections.id, input.selectionId), eq(projectFinishSelections.projectId, input.projectId)))
    .get()
  if (!old) return failed("Selection not found.")
  const blocker = replacementBlocker(old.status, await selectionIsReplaced(db, old.id), input.reason)
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

  const { settings } = await readProjectSelectionSettings(db, input.projectId)
  const created = settings.replacementChangeOrder
    ? await replacementChangeOrder(db, { projectId: input.projectId, newId, old, pick: pick ?? null, label, note, reason: input.reason, actor: input.actor, now })
    : { changeOrder: null, changeOrderError: null }
  const { changeOrder, changeOrderError } = created

  await recordActivityEvents(db, [
    {
      organizationId: input.organizationId,
      projectId: input.projectId,
      actor: input.actor,
      category: "field",
      action: "selection_replaced",
      entityType: "project_finish_selection",
      entityId: old.id,
      summary: `${old.name} (${old.status}) was replaced by a new selection: ${label.toLocaleLowerCase()}${pick ? `, ${pick.title} chosen` : ""}.${changeOrder ? ` Draft change order ${changeOrder.number} created.` : ""}`,
      metadata: { replacementSelectionId: newId, reason: input.reason, choiceId: pick?.id ?? null, changeOrderId: changeOrder?.id ?? null },
      createdAt: now,
    },
  ])
  return { ok: true, selectionId: newId, changeOrder, changeOrderError }
}

/** The draft change order a replacement starts; a failure is reported, the replacement stands. */
async function replacementChangeOrder(
  db: Db,
  input: {
    readonly projectId: string
    readonly newId: string
    readonly old: { readonly id: string; readonly name: string; readonly roomName: string; readonly costCode: string | null }
    readonly pick: { readonly title: string; readonly ownerPriceCents: number | null } | null
    readonly label: string
    readonly note: string | null
    readonly reason: SelectionReplacementReason
    readonly actor: SelectionChangeOrderActor
    readonly now: string
  },
): Promise<{ readonly changeOrder: { readonly id: string; readonly number: string } | null; readonly changeOrderError: string | null }> {
  const { old, pick, label, note } = input
  try {
    const costCode = old.costCode?.trim() ?? ""
    const priced = pick !== null && pick.ownerPriceCents !== null && costCode !== ""
    const changeOrder = await createSelectionChangeOrder(db, {
      projectId: input.projectId,
      start: { kind: "draft" },
      sourceType: "selection_replacement",
      sourceRecordId: input.newId,
      title: `${label}: ${old.name}`,
      scope:
        `${old.roomName} · ${old.name}: ${label.toLocaleLowerCase()}` +
        (pick ? `, replaced with ${pick.title}.` : "; the new selection is still to be made.") +
        " The earlier selection stays on record.",
      reason: note ?? label,
      lines: priced && pick ? [{ costCode, description: `${old.name}: ${pick.title} (${label.toLocaleLowerCase()})`.slice(0, 500), amountCents: pick.ownerPriceCents ?? 0 }] : [],
      history: {
        eventType: "created_from_selection_replacement",
        note: `Created when ${old.name} was replaced (${label.toLocaleLowerCase()}). Complete the amounts before sending it for the owner's signature.`,
        metadata: { replacedSelectionId: old.id, selectionId: input.newId, reason: input.reason },
      },
      actor: input.actor,
      now: input.now,
    })
    return { changeOrder, changeOrderError: null }
  } catch (error) {
    console.error("[selections] replacement change order failed", error)
    return { changeOrder: null, changeOrderError: error instanceof Error ? error.message : "The change order could not be created." }
  }
}
