import { sql, type SQL } from "drizzle-orm"
import {
  projectSelectionDecisions as decisions,
  projectSelectionRequests as requests,
  projectSelectionProcurementLinks as links,
  projectSelectionDecisionEvents as events,
} from "@/db/schema-selection-decisions"
import { projectSelectionComments as comments } from "@/db/schema-selection-choices"

// Apply at the delete itself, including spreadsheet reconciliation, so an owner
// request, approval or owner comment created concurrently cannot be removed by a stale read.
export function selectionDeletionAllowed(selectionId: string): SQL {
  return sql`NOT EXISTS (SELECT 1 FROM ${decisions} WHERE ${decisions.selectionId} = ${selectionId} AND (${decisions.published} = 1 OR ${decisions.approvedAt} IS NOT NULL))
    AND NOT EXISTS (SELECT 1 FROM ${events} WHERE ${events.selectionId} = ${selectionId} AND ${events.kind} = 'owner_approved')
    AND NOT EXISTS (SELECT 1 FROM ${requests} WHERE ${requests.selectionId} = ${selectionId})
    AND NOT EXISTS (SELECT 1 FROM ${links} WHERE ${links.selectionId} = ${selectionId})
    AND NOT EXISTS (SELECT 1 FROM ${comments} WHERE ${comments.selectionId} = ${selectionId} AND ${comments.authorAudience} = 'owner')`
}
