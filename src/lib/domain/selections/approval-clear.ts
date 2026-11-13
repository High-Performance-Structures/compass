/**
 * The one way an owner approval on a selection is cleared, used by every
 * path that clears it on an edit: the staff edit form (a material change),
 * a decision published or withdrawn, and the finish-schedule re-import.
 * (A pick change never clears an approval: an approved selection's pick
 * can't change; owner decision 2026-11-12.)
 *
 * An owner approval is never cleared by these edits, whether a signature
 * covers it or it was imported already approved (e.g. from Buildertrend:
 * settled and billed there): after approval, changes go through a change
 * order, so a signed selection never re-enters a Selection Phase (and is
 * never billed twice) through an edit. Staff get the existing "Review
 * change order impact" to-do.
 *
 * The patch names the outer table in full, for use in an UPDATE of
 * project_finish_selections. The workbook re-import counts a change to an
 * approved row as a conflict for staff.
 */
import { sql, type SQL } from "drizzle-orm"

/** The owner's approval is recorded (signed or imported). */
const ownerApproval = sql`(project_finish_selections.owner_approved = 1)`

/**
 * The columns that clear an approval on an edit: an owner approval, signed
 * or imported, is always kept (after approval, changes go through a change
 * order; staff get the "Review change order impact" to-do). Only approval
 * columns left on a row without an owner approval are cleared.
 */
export function clearApprovalPatch(): { readonly ownerApproved: SQL; readonly approvedBy: SQL; readonly approvedAt: SQL } {
  return {
    ownerApproved: sql`CASE WHEN ${ownerApproval} THEN project_finish_selections.owner_approved ELSE 0 END`,
    approvedBy: sql`CASE WHEN ${ownerApproval} THEN project_finish_selections.approved_by ELSE NULL END`,
    approvedAt: sql`CASE WHEN ${ownerApproval} THEN project_finish_selections.approved_at ELSE NULL END`,
  }
}
