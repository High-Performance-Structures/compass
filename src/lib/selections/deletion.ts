import { sql, type SQL } from "drizzle-orm"
import {
  projectSelectionDecisions as decisions,
  projectSelectionRequests as requests,
  projectSelectionProcurementLinks as links,
  projectSelectionDecisionEvents as events,
} from "@/db/schema-selection-decisions"
import { projectSelectionComments as comments } from "@/db/schema-selection-choices"
import { LOCKED_SELECTION_STATUSES } from "@/lib/domain/selections/locks"

// Apply at the delete itself, including spreadsheet reconciliation, so an owner
// request, approval or owner comment created concurrently cannot be removed by a stale read.
// Ordered and installed selections, and any selection a replacement points to,
// stay on record (locked; see src/lib/domain/selections/locks.ts). A
// replacement stays while its change order is live (void or declined ends it).
export function selectionDeletionAllowed(selectionId: string): SQL {
  return sql`NOT EXISTS (SELECT 1 FROM ${decisions} WHERE ${decisions.selectionId} = ${selectionId} AND (${decisions.published} = 1 OR ${decisions.approvedAt} IS NOT NULL))
    AND NOT EXISTS (SELECT 1 FROM ${events} WHERE ${events.selectionId} = ${selectionId} AND ${events.kind} = 'owner_approved')
    AND NOT EXISTS (SELECT 1 FROM ${requests} WHERE ${requests.selectionId} = ${selectionId})
    AND NOT EXISTS (SELECT 1 FROM ${links} WHERE ${links.selectionId} = ${selectionId})
    AND NOT EXISTS (SELECT 1 FROM ${comments} WHERE ${comments.selectionId} = ${selectionId} AND ${comments.authorAudience} = 'owner')
    AND NOT EXISTS (SELECT 1 FROM project_finish_selections AS locked WHERE locked.id = ${selectionId} AND locked.status IN (${sql.join(LOCKED_SELECTION_STATUSES.map((status) => sql`${status}`), sql`, `)}))
    AND NOT EXISTS (SELECT 1 FROM project_finish_selections AS replacement WHERE replacement.replaces_selection_id = ${selectionId})
    AND NOT EXISTS (SELECT 1 FROM project_change_orders AS replacement_change WHERE replacement_change.source_type = 'selection_replacement' AND replacement_change.source_record_id = ${selectionId} AND replacement_change.status NOT IN ('void', 'declined'))`
}
