import type { getDb } from "@/db"
import type { PaperTrailRecordType } from "@/db/schema-paper-trail"
import {
  insertRecordDriveSnapshotDue,
  markRecordDriveFileRemoved,
  upsertRecordDriveFileDue,
} from "@/lib/domain/documents/store"

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
    await upsertRecordDriveFileDue(db, { ...input, now })
    if (input.milestone) {
      await insertRecordDriveSnapshotDue(db, { ...input, milestone: input.milestone, now })
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
    await markRecordDriveFileRemoved(db, { ...input, now: new Date().toISOString() })
  } catch (error) {
    console.error(`[paper-trail] could not mark ${input.recordType} removed: ${error instanceof Error ? error.name : "unknown"}`)
  }
}
