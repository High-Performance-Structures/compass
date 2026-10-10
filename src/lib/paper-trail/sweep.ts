import { sql, type SQL } from "drizzle-orm"
import type { getDb } from "@/db"
import type { PaperTrailRecordType } from "@/db/schema-paper-trail"
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
  if (settings.mode === "on") return sql`p.organization_id = ${organizationId}`
  if (settings.pilotProjectIds.length === 0) return null
  return sql`p.organization_id = ${organizationId} AND p.id IN (${sql.join(
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
  for (const recordType of Object.keys(CHANGED_RECORDS) as PaperTrailRecordType[]) {
    if (!settings[PAPER_TRAIL_RECORDS[recordType].setting]) continue
    await db.run(sql`
      INSERT INTO project_record_drive_files
        (id, organization_id, project_id, record_type, record_id, status, due_at, changed_at, source_changed_at, attempts, created_at, updated_at)
      SELECT lower(hex(randomblob(16))), p.organization_id, x.project_id, ${recordType}, x.id, 'pending', ${stamp}, x.changed, x.changed, 0, ${stamp}, ${stamp}
      FROM (${CHANGED_RECORDS[recordType]}) x
      JOIN projects p ON p.id = x.project_id
      LEFT JOIN project_record_drive_files f ON f.record_type = ${recordType} AND f.record_id = x.id
      WHERE ${scope}
        AND (f.id IS NULL OR (f.status <> 'removed' AND x.changed > coalesce(f.source_changed_at, '')))
      ON CONFLICT (record_type, record_id) DO UPDATE SET
        status = 'pending',
        due_at = excluded.due_at,
        changed_at = max(project_record_drive_files.changed_at, excluded.changed_at),
        source_changed_at = excluded.source_changed_at,
        attempts = 0,
        last_error = NULL,
        updated_at = excluded.updated_at
    `)
    const milestone = MILESTONES[recordType]
    if (!settings.milestoneCopies || !milestone) continue
    await db.run(sql`
      INSERT INTO project_record_drive_snapshots
        (id, organization_id, project_id, record_type, record_id, milestone, milestone_at, status, requested_at, attempts)
      SELECT lower(hex(randomblob(16))), p.organization_id, m.project_id, ${recordType}, m.id, ${milestone.milestone}, m.at, 'pending', ${stamp}, 0
      FROM (${milestone.rows}) m
      JOIN projects p ON p.id = m.project_id
      WHERE ${scope}
      ON CONFLICT DO NOTHING
    `)
  }
}
