/**
 * The one way an owner approval on a selection is cleared, used by every
 * path that clears it on an edit: the staff edit form (a material change),
 * a decision published or withdrawn, and the finish-schedule re-import.
 * (A pick change never clears an approval: an approved selection's pick
 * can't change; owner decision 2026-11-12.)
 *
 * An approval no signature covers (imported already approved, e.g. from
 * Buildertrend: settled and billed there) is never cleared by these edits.
 * An approval a signature covers is cleared, back to the owner.
 *
 * Every fragment names the outer table in full, for use in an UPDATE of
 * project_finish_selections.
 */
import { and, eq, sql, type SQL } from "drizzle-orm"

import { projectFinishSelections } from "@/db/schema"
import type { Db } from "@/lib/server/action-context"

const pickId = sql`(SELECT pick.id FROM project_selection_choices AS pick WHERE pick.selection_id = project_finish_selections.id AND pick.chosen = 1)`
/** A signature covers the current pick: a signed Selection Phase, or the replacement's executed change order. */
const pickSigned = sql`(EXISTS (SELECT 1 FROM project_selection_round_signature_items AS item INNER JOIN project_selection_round_signatures AS round ON round.id = item.signature_id WHERE round.status = 'signed' AND item.selection_id = project_finish_selections.id AND item.choice_id = ${pickId})
  OR EXISTS (SELECT 1 FROM project_change_orders AS replacement_change WHERE replacement_change.source_type = 'selection_replacement' AND replacement_change.source_record_id = project_finish_selections.id AND replacement_change.status IN ('executed', 'sage_pending', 'synced', 'closed')))`
/** Approved, with no signature on the current pick (an imported approval). */
const unsignedApproval = sql`(project_finish_selections.owner_approved = 1 AND NOT ${pickSigned})`

/** The columns that clear an approval, keeping an unsigned (imported) one as it is. */
export function clearApprovalPatch(): { readonly ownerApproved: SQL; readonly approvedBy: SQL; readonly approvedAt: SQL } {
  return {
    ownerApproved: sql`CASE WHEN ${unsignedApproval} THEN project_finish_selections.owner_approved ELSE 0 END`,
    approvedBy: sql`CASE WHEN ${unsignedApproval} THEN project_finish_selections.approved_by ELSE NULL END`,
    approvedAt: sql`CASE WHEN ${unsignedApproval} THEN project_finish_selections.approved_at ELSE NULL END`,
  }
}

/** What clearing the selection's approval would do now: nothing to clear, keep it (imported), or clear it. */
export async function approvalClearOutcome(db: Db, input: { readonly projectId: string; readonly selectionId: string }): Promise<"none" | "keep" | "clear"> {
  const row = await db
    .select({ approved: projectFinishSelections.ownerApproved, unsigned: sql<number>`${unsignedApproval}` })
    .from(projectFinishSelections)
    .where(and(eq(projectFinishSelections.id, input.selectionId), eq(projectFinishSelections.projectId, input.projectId)))
    .get()
  if (!row?.approved) return "none"
  return row.unsigned === 1 ? "keep" : "clear"
}
