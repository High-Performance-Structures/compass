/**
 * The one way an owner approval on a selection is cleared (owner rule: a
 * change after an approval is a change order; it must never be billed
 * twice). Used by every path that clears approval: the staff edit form, a
 * decision published or withdrawn, the finish-schedule re-import, and a
 * staff pick change.
 *
 * - An approval no signature covers (imported already approved, e.g. from
 *   Buildertrend: settled and billed there) is kept on edits that aren't a
 *   pick change. Only a pick change reopens it.
 * - Clearing an approval keeps the price already in the contract as
 *   `settled_owner_price_cents`, in the same statement: an existing settled
 *   price stays unless the current pick was signed since (then the signed
 *   price), else the signed price, else the current pick's owner price. The
 *   next Selection Phase bills only the difference.
 * - With no price to keep, clearing is refused: there is nothing to bill the
 *   difference against.
 *
 * Every fragment names the outer table in full, for use in an UPDATE of
 * project_finish_selections.
 */
import { and, eq, sql, type SQL } from "drizzle-orm"

import { projectFinishSelections } from "@/db/schema"
import type { Db } from "@/lib/server/action-context"

const pickId = sql`(SELECT pick.id FROM project_selection_choices AS pick WHERE pick.selection_id = project_finish_selections.id AND pick.chosen = 1)`
const pickPrice = sql`(SELECT pick.owner_price_cents FROM project_selection_choices AS pick WHERE pick.selection_id = project_finish_selections.id AND pick.chosen = 1)`
/** The owner price a signed Selection Phase recorded for the current pick (latest). */
const signedPrice = sql`(SELECT item.owner_price_cents_snapshot FROM project_selection_round_signature_items AS item INNER JOIN project_selection_round_signatures AS round ON round.id = item.signature_id WHERE round.status = 'signed' AND item.selection_id = project_finish_selections.id AND item.choice_id = ${pickId} ORDER BY round.signed_at DESC LIMIT 1)`
/** A signature covers the current pick: a signed Selection Phase, or the replacement's executed change order priced for it. */
const pickSigned = sql`(EXISTS (SELECT 1 FROM project_selection_round_signature_items AS item INNER JOIN project_selection_round_signatures AS round ON round.id = item.signature_id WHERE round.status = 'signed' AND item.selection_id = project_finish_selections.id AND item.choice_id = ${pickId})
  OR EXISTS (SELECT 1 FROM project_change_orders AS replacement_change WHERE replacement_change.source_type = 'selection_replacement' AND replacement_change.source_record_id = project_finish_selections.id AND replacement_change.status IN ('executed', 'sage_pending', 'synced', 'closed') AND project_finish_selections.replacement_priced_choice_id = ${pickId}))`
/** Approved, with no signature on the current pick (an imported approval). */
const unsignedApproval = sql`(project_finish_selections.owner_approved = 1 AND NOT ${pickSigned})`
/** The price already in the contract for the current pick, kept when its approval is cleared. */
const settledPrice = sql`(CASE WHEN ${pickSigned} THEN COALESCE(${signedPrice}, ${pickPrice}) ELSE COALESCE(project_finish_selections.settled_owner_price_cents, ${pickPrice}) END)`

/**
 * The columns that clear an approval. `pickChange`: the pick is changing, so
 * an unsigned approval clears too; otherwise it is kept. Never clears where
 * the kept price would be unknown (the row stays approved; callers refuse
 * first with approvalClearOutcome).
 */
export function clearApprovalPatch(options: { readonly pickChange: boolean }): {
  readonly ownerApproved: SQL
  readonly approvedBy: SQL
  readonly approvedAt: SQL
  readonly settledOwnerPriceCents: SQL
} {
  const keep = options.pickChange
    ? sql`(project_finish_selections.owner_approved = 1 AND ${settledPrice} IS NULL)`
    : sql`(${unsignedApproval} OR (project_finish_selections.owner_approved = 1 AND ${settledPrice} IS NULL))`
  return {
    ownerApproved: sql`CASE WHEN ${keep} THEN project_finish_selections.owner_approved ELSE 0 END`,
    approvedBy: sql`CASE WHEN ${keep} THEN project_finish_selections.approved_by ELSE NULL END`,
    approvedAt: sql`CASE WHEN ${keep} THEN project_finish_selections.approved_at ELSE NULL END`,
    settledOwnerPriceCents: sql`CASE WHEN project_finish_selections.owner_approved = 1 AND NOT ${keep} THEN ${settledPrice} ELSE project_finish_selections.settled_owner_price_cents END`,
  }
}

export type ApprovalClearOutcome =
  /** Not approved: nothing to clear. */
  | "none"
  /** An unsigned (imported) approval: kept on edits that aren't a pick change. */
  | "keep"
  /** Cleared, keeping the settled price. */
  | "clear"
  /** Approved with no price to keep: refuse. */
  | "refuse"

/** What clearing the selection's approval would do now (the same rules as clearApprovalPatch). */
export async function approvalClearOutcome(
  db: Db,
  input: { readonly projectId: string; readonly selectionId: string; readonly pickChange: boolean },
): Promise<ApprovalClearOutcome> {
  const row = await db
    .select({
      approved: projectFinishSelections.ownerApproved,
      unsigned: sql<number>`${unsignedApproval}`,
      settled: sql<number | null>`${settledPrice}`,
    })
    .from(projectFinishSelections)
    .where(and(eq(projectFinishSelections.id, input.selectionId), eq(projectFinishSelections.projectId, input.projectId)))
    .get()
  if (!row?.approved) return "none"
  if (!input.pickChange && row.unsigned === 1) return "keep"
  return row.settled === null ? "refuse" : "clear"
}

/** Why an approval can't be cleared (no price kept for it). Not ordered yet: a change order. */
export function noSettledPriceMessage(releasedFromOrder: boolean): string {
  return `This selection was approved in Buildertrend without a recorded price. ${releasedFromOrder ? "Use Replace or a change order." : "Use a change order."}`
}
