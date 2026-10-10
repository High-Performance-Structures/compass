import { sql } from "drizzle-orm"
import type { getDb } from "@/db"
import type { PaperTrailRecordType } from "@/db/schema-paper-trail"

export type PaperTrailMilestone = "sent" | "signed" | "approved" | "answered"

/**
 * Marks a record as changed so the scheduled job refreshes its Drive copy.
 * This is the only paper-trail work on the request path: one upsert (two with
 * a milestone). Failures are logged and swallowed so saving to Drive can never
 * block or fail the person's edit. Rows are written whatever the company's
 * settings are; the job applies the settings, so turning the feature on later
 * picks up everything edited in the meantime.
 */
export async function markPaperTrailDue(
  db: ReturnType<typeof getDb>,
  input: {
    readonly projectId: string
    readonly recordType: PaperTrailRecordType
    readonly recordId: string
    readonly milestone?: PaperTrailMilestone
  },
): Promise<void> {
  const now = new Date().toISOString()
  try {
    await db.run(sql`
      INSERT INTO project_record_drive_files
        (id, organization_id, project_id, record_type, record_id, status, due_at, changed_at, attempts, created_at, updated_at)
      SELECT ${crypto.randomUUID()}, p.organization_id, p.id, ${input.recordType}, ${input.recordId}, 'pending', ${now}, ${now}, 0, ${now}, ${now}
      FROM projects p
      WHERE p.id = ${input.projectId} AND p.organization_id IS NOT NULL
      ON CONFLICT (record_type, record_id) DO UPDATE SET
        status = CASE WHEN status = 'removed' THEN 'removed' ELSE 'pending' END,
        due_at = excluded.due_at,
        changed_at = excluded.changed_at,
        attempts = 0,
        last_error = NULL,
        updated_at = excluded.updated_at
    `)
    if (input.milestone) {
      await db.run(sql`
        INSERT INTO project_record_drive_snapshots
          (id, organization_id, project_id, record_type, record_id, milestone, milestone_at, status, requested_at, attempts)
        SELECT ${crypto.randomUUID()}, p.organization_id, p.id, ${input.recordType}, ${input.recordId}, ${input.milestone}, ${now}, 'pending', ${now}, 0
        FROM projects p
        WHERE p.id = ${input.projectId} AND p.organization_id IS NOT NULL
        ON CONFLICT DO NOTHING
      `)
    }
  } catch (error) {
    console.error(
      `[paper-trail] could not mark ${input.recordType} for saving: ${error instanceof Error ? error.name : "unknown"}`,
    )
  }
}

/** Records that were deleted keep their last Drive copy; the job stops refreshing them. */
export async function markPaperTrailRemoved(
  db: ReturnType<typeof getDb>,
  input: { readonly recordType: PaperTrailRecordType; readonly recordId: string },
): Promise<void> {
  try {
    await db.run(sql`
      UPDATE project_record_drive_files
      SET status = 'removed', updated_at = ${new Date().toISOString()}
      WHERE record_type = ${input.recordType} AND record_id = ${input.recordId}
    `)
  } catch (error) {
    console.error(`[paper-trail] could not mark ${input.recordType} removed: ${error instanceof Error ? error.name : "unknown"}`)
  }
}
