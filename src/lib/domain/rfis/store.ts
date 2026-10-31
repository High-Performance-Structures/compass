/**
 * The only code that inserts, updates, or deletes project_rfis and
 * project_rfi_attachments (architecture standard, section 1). No auth here:
 * callers resolve the action context first.
 *
 * Functions named `...Statement` return an unexecuted statement so a caller
 * can put it in one atomic batch with another module's write (a vendor
 * assignment or a participant grant).
 */
import { and, eq } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"

import { projectRfiAttachments, projectRfis } from "@/db/schema"
import type { Db } from "@/lib/server/action-context"

type RfiInsert = typeof projectRfis.$inferInsert
type RfiUpdate = Partial<Omit<RfiInsert, "id" | "projectId">>
type RfiAttachmentInsert = typeof projectRfiAttachments.$inferInsert

export function rfiInsertStatement(db: Db, row: RfiInsert): BatchItem<"sqlite"> {
  return db.insert(projectRfis).values(row)
}

export async function insertRfi(db: Db, row: RfiInsert): Promise<void> {
  await db.insert(projectRfis).values(row)
}

/** Inserts an RFI unless one with the same id already exists (re-imported email). */
export async function insertRfiIfMissing(db: Db, row: RfiInsert): Promise<void> {
  await db.insert(projectRfis).values(row).onConflictDoNothing({ target: projectRfis.id })
}

export function rfiAttachmentsInsertStatement(
  db: Db,
  rows: readonly RfiAttachmentInsert[]
): BatchItem<"sqlite"> {
  return db.insert(projectRfiAttachments).values([...rows])
}

export function rfiUpdateStatement(
  db: Db,
  projectId: string,
  rfiId: string,
  values: RfiUpdate
): BatchItem<"sqlite"> {
  return db
    .update(projectRfis)
    .set(values)
    .where(and(eq(projectRfis.id, rfiId), eq(projectRfis.projectId, projectId)))
}

export async function updateRfi(db: Db, projectId: string, rfiId: string, values: RfiUpdate): Promise<void> {
  await db
    .update(projectRfis)
    .set(values)
    .where(and(eq(projectRfis.id, rfiId), eq(projectRfis.projectId, projectId)))
}

/** Attachments cascade through their foreign key. */
export function rfiDeleteStatement(db: Db, projectId: string, rfiId: string): BatchItem<"sqlite"> {
  return db.delete(projectRfis).where(and(eq(projectRfis.id, rfiId), eq(projectRfis.projectId, projectId)))
}
