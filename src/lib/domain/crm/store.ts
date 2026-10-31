import type { SQL } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"
import type { IndexColumn, SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core"

import { projectFollowUps, projectInteractions, projectNotes } from "@/db/schema"
import type { Db } from "@/lib/server/action-context"

/*
 * The only code that inserts, updates or deletes client relationship records: project interactions, follow-ups and notes
 * (architecture standard, section 1).
 *
 * Each table has the same small set of writers. `*Statement` builds an
 * unexecuted statement for `db.batch`; the plain form runs one statement.
 * Callers pass the same `where` conditions they used before, so the SQL is
 * unchanged. The store has no access rules; callers check access first.
 */

/** One statement for `db.batch([...])`. */
export type Statement = BatchItem<"sqlite">

type ConflictTarget = IndexColumn | IndexColumn[]

type Upsert<TPatch> = {
  readonly target: ConflictTarget
  readonly set: TPatch
  readonly targetWhere?: SQL
  readonly setWhere?: SQL
}

function isRows<T extends object>(values: T | readonly T[]): values is readonly T[] {
  return Array.isArray(values)
}

// ---- projectInteractions

type ProjectInteractionInsert = typeof projectInteractions.$inferInsert
type ProjectInteractionPatch = SQLiteUpdateSetSource<typeof projectInteractions>

export function insertProjectInteractionStatement(db: Db, values: ProjectInteractionInsert | readonly ProjectInteractionInsert[]): Statement {
  return isRows(values) ? db.insert(projectInteractions).values([...values]) : db.insert(projectInteractions).values(values)
}

export async function insertProjectInteraction(db: Db, values: ProjectInteractionInsert | readonly ProjectInteractionInsert[]): Promise<D1Result> {
  return isRows(values) ? db.insert(projectInteractions).values([...values]).run() : db.insert(projectInteractions).values(values).run()
}

/** `ON CONFLICT DO NOTHING`, on `target` when given, else on any constraint. */
export function insertProjectInteractionIfAbsentStatement(
  db: Db,
  values: ProjectInteractionInsert | readonly ProjectInteractionInsert[],
  target?: ConflictTarget,
): Statement {
  const config = target ? { target } : undefined
  return isRows(values)
    ? db.insert(projectInteractions).values([...values]).onConflictDoNothing(config)
    : db.insert(projectInteractions).values(values).onConflictDoNothing(config)
}

export async function insertProjectInteractionIfAbsent(
  db: Db,
  values: ProjectInteractionInsert | readonly ProjectInteractionInsert[],
  target?: ConflictTarget,
): Promise<D1Result> {
  const config = target ? { target } : undefined
  return isRows(values)
    ? db.insert(projectInteractions).values([...values]).onConflictDoNothing(config).run()
    : db.insert(projectInteractions).values(values).onConflictDoNothing(config).run()
}

export async function updateProjectInteractions(db: Db, where: SQL | undefined, patch: ProjectInteractionPatch): Promise<D1Result> {
  return db.update(projectInteractions).set(patch).where(where).run()
}

// ---- projectFollowUps

type ProjectFollowUpInsert = typeof projectFollowUps.$inferInsert
type ProjectFollowUpPatch = SQLiteUpdateSetSource<typeof projectFollowUps>

export async function upsertProjectFollowUp(
  db: Db,
  values: ProjectFollowUpInsert | readonly ProjectFollowUpInsert[],
  conflict: Upsert<ProjectFollowUpPatch>,
): Promise<D1Result> {
  return isRows(values)
    ? db.insert(projectFollowUps).values([...values]).onConflictDoUpdate(conflict).run()
    : db.insert(projectFollowUps).values(values).onConflictDoUpdate(conflict).run()
}

export async function deleteProjectFollowUps(db: Db, where: SQL | undefined): Promise<D1Result> {
  return db.delete(projectFollowUps).where(where).run()
}

// ---- projectNotes

type ProjectNoteInsert = typeof projectNotes.$inferInsert
type ProjectNotePatch = SQLiteUpdateSetSource<typeof projectNotes>

export async function insertProjectNote(db: Db, values: ProjectNoteInsert | readonly ProjectNoteInsert[]): Promise<D1Result> {
  return isRows(values) ? db.insert(projectNotes).values([...values]).run() : db.insert(projectNotes).values(values).run()
}

export async function updateProjectNotes(db: Db, where: SQL | undefined, patch: ProjectNotePatch): Promise<D1Result> {
  return db.update(projectNotes).set(patch).where(where).run()
}

