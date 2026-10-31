import { sql, type SQL } from "drizzle-orm"
import type { getDb } from "@/db"
import type { PaperTrailRecordType } from "@/db/schema-paper-trail"
import { queueChangedRecordDriveFiles, queueMilestoneRecordDriveSnapshots } from "@/lib/domain/documents/store"
import type { PaperTrailSettings } from "@/lib/feature-settings/registry"
import { PAPER_TRAIL_RECORDS } from "@/lib/paper-trail/record-types"

type Db = ReturnType<typeof getDb>

/**
 * Each record type's rows with the time anything on its sheet last changed.
 * Child rows (lines, attachments, history) count, because some edits touch
 * only those.
 */
const CHANGED_RECORDS: { readonly [K in PaperTrailRecordType]: SQL } = {
  purchase_order: sql`
    SELECT o.id AS id, o.project_id AS project_id,
      max(o.updated_at, coalesce((SELECT max(l.updated_at) FROM project_purchase_order_lines l WHERE l.operation_id = o.id), '')) AS changed
    FROM project_operations o WHERE o.source_record_type = 'purchase_order'`,
  estimate: sql`
    SELECT e.id AS id, e.project_id AS project_id,
      max(e.updated_at, coalesce((SELECT max(l.updated_at) FROM project_estimate_lines l WHERE l.estimate_id = e.id), '')) AS changed
    FROM project_estimates e`,
  rfi: sql`
    SELECT r.id AS id, r.project_id AS project_id,
      max(r.updated_at, coalesce((SELECT max(a.updated_at) FROM project_rfi_attachments a WHERE a.rfi_id = r.id), '')) AS changed
    FROM project_rfis r`,
  change_order: sql`
    SELECT c.id AS id, c.project_id AS project_id,
      max(
        c.updated_at,
        coalesce((SELECT max(l.updated_at) FROM project_change_order_lines l WHERE l.change_order_id = c.id), ''),
        coalesce((SELECT max(d.created_at) FROM project_change_order_documents d WHERE d.change_order_id = c.id), ''),
        coalesce((SELECT max(h.created_at) FROM project_change_order_history h WHERE h.change_order_id = c.id), '')
      ) AS changed
    FROM project_change_orders c`,
  // Drafts are never saved; issued and voided tickets are.
  shop_ticket: sql`
    SELECT t.id AS id, t.project_id AS project_id,
      max(t.updated_at, coalesce((SELECT max(l.updated_at) FROM shop_ticket_lines l WHERE l.ticket_id = t.id), '')) AS changed
    FROM shop_tickets t WHERE t.status <> 'draft'`,
}

/** Milestones the sweep can read from stored data; a PO's "sent" comes from the email action. */
const MILESTONES: { readonly [K in PaperTrailRecordType]?: { readonly milestone: string; readonly rows: SQL } } = {
  estimate: {
    milestone: "signed",
    rows: sql`SELECT e.id AS id, e.project_id AS project_id, coalesce(e.signed_at, e.accepted_at) AS at
      FROM project_estimates e WHERE coalesce(e.signed_at, e.accepted_at) IS NOT NULL`,
  },
  rfi: {
    milestone: "answered",
    rows: sql`SELECT r.id AS id, r.project_id AS project_id, r.answered_at AS at
      FROM project_rfis r WHERE r.answered_at IS NOT NULL`,
  },
  change_order: {
    milestone: "approved",
    rows: sql`SELECT c.id AS id, c.project_id AS project_id, c.executed_at AS at
      FROM project_change_orders c WHERE c.executed_at IS NOT NULL`,
  },
}

/** Limits a query to the company's projects the settings allow. */
function projectScope(organizationId: string, settings: PaperTrailSettings): SQL | null {
  if (settings.mode === "off") return null
  // Internal workspaces (H-Office, the yard) have no project folders to save into.
  if (settings.mode === "on") return sql`p.organization_id = ${organizationId} AND p.workspace_kind IS NULL`
  if (settings.pilotProjectIds.length === 0) return null
  return sql`p.organization_id = ${organizationId} AND p.workspace_kind IS NULL AND p.id IN (${sql.join(
    settings.pilotProjectIds.map((id) => sql`${id}`),
    sql`, `,
  )})`
}

/**
 * Queues every record whose sheet changed since its last copy, and every new
 * milestone. Runs every ten minutes; between sweeps, edits made through the
 * hooked actions are already queued. The first sweep after the feature is
 * turned on queues all existing records, which is the catch-up.
 */
export async function sweepPaperTrailChanges(
  db: Db,
  organizationId: string,
  settings: PaperTrailSettings,
  now: Date,
): Promise<void> {
  const scope = projectScope(organizationId, settings)
  if (!scope) return
  const stamp = now.toISOString()
  // One set-based statement per record type (five fixed types), not per record.
  for (const recordType of Object.keys(CHANGED_RECORDS) as PaperTrailRecordType[]) {
    if (!settings[PAPER_TRAIL_RECORDS[recordType].setting]) continue
    await queueChangedRecordDriveFiles(db, { recordType, changedRows: CHANGED_RECORDS[recordType], projectScope: scope, stamp })
    const milestone = MILESTONES[recordType]
    if (!settings.milestoneCopies || !milestone) continue
    await queueMilestoneRecordDriveSnapshots(db, {
      recordType,
      milestone: milestone.milestone,
      milestoneRows: milestone.rows,
      projectScope: scope,
      stamp,
    })
  }
}
