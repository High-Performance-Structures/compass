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

export function upsertProjectInteractionStatement(
  db: Db,
  values: ProjectInteractionInsert | readonly ProjectInteractionInsert[],
  conflict: Upsert<ProjectInteractionPatch>,
): Statement {
  return isRows(values)
    ? db.insert(projectInteractions).values([...values]).onConflictDoUpdate(conflict)
    : db.insert(projectInteractions).values(values).onConflictDoUpdate(conflict)
}

export async function upsertProjectInteraction(
  db: Db,
  values: ProjectInteractionInsert | readonly ProjectInteractionInsert[],
  conflict: Upsert<ProjectInteractionPatch>,
): Promise<D1Result> {
  return isRows(values)
    ? db.insert(projectInteractions).values([...values]).onConflictDoUpdate(conflict).run()
    : db.insert(projectInteractions).values(values).onConflictDoUpdate(conflict).run()
}

export function updateProjectInteractionsStatement(db: Db, where: SQL | undefined, patch: ProjectInteractionPatch): Statement {
  return db.update(projectInteractions).set(patch).where(where)
}

export async function updateProjectInteractions(db: Db, where: SQL | undefined, patch: ProjectInteractionPatch): Promise<D1Result> {
  return db.update(projectInteractions).set(patch).where(where).run()
}

/** The ids of the rows the update changed. */
export async function updateProjectInteractionsReturningIds(
  db: Db,
  where: SQL | undefined,
  patch: ProjectInteractionPatch,
): Promise<readonly { readonly id: string }[]> {
  return db.update(projectInteractions).set(patch).where(where).returning({ id: projectInteractions.id })
}

export function deleteProjectInteractionsStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectInteractions).where(where)
}

export async function deleteProjectInteractions(db: Db, where: SQL | undefined): Promise<D1Result> {
  return db.delete(projectInteractions).where(where).run()
}

/** The ids of the rows the delete removed. */
export async function deleteProjectInteractionsReturningIds(
  db: Db,
  where: SQL | undefined,
): Promise<readonly { readonly id: string }[]> {
  return db.delete(projectInteractions).where(where).returning({ id: projectInteractions.id })
}

// ---- projectFollowUps

type ProjectFollowUpInsert = typeof projectFollowUps.$inferInsert
type ProjectFollowUpPatch = SQLiteUpdateSetSource<typeof projectFollowUps>

export function insertProjectFollowUpStatement(db: Db, values: ProjectFollowUpInsert | readonly ProjectFollowUpInsert[]): Statement {
  return isRows(values) ? db.insert(projectFollowUps).values([...values]) : db.insert(projectFollowUps).values(values)
}

export async function insertProjectFollowUp(db: Db, values: ProjectFollowUpInsert | readonly ProjectFollowUpInsert[]): Promise<D1Result> {
  return isRows(values) ? db.insert(projectFollowUps).values([...values]).run() : db.insert(projectFollowUps).values(values).run()
}

/** `ON CONFLICT DO NOTHING`, on `target` when given, else on any constraint. */
export function insertProjectFollowUpIfAbsentStatement(
  db: Db,
  values: ProjectFollowUpInsert | readonly ProjectFollowUpInsert[],
  target?: ConflictTarget,
): Statement {
  const config = target ? { target } : undefined
  return isRows(values)
    ? db.insert(projectFollowUps).values([...values]).onConflictDoNothing(config)
    : db.insert(projectFollowUps).values(values).onConflictDoNothing(config)
}

export async function insertProjectFollowUpIfAbsent(
  db: Db,
  values: ProjectFollowUpInsert | readonly ProjectFollowUpInsert[],
  target?: ConflictTarget,
): Promise<D1Result> {
  const config = target ? { target } : undefined
  return isRows(values)
    ? db.insert(projectFollowUps).values([...values]).onConflictDoNothing(config).run()
    : db.insert(projectFollowUps).values(values).onConflictDoNothing(config).run()
}

export function upsertProjectFollowUpStatement(
  db: Db,
  values: ProjectFollowUpInsert | readonly ProjectFollowUpInsert[],
  conflict: Upsert<ProjectFollowUpPatch>,
): Statement {
  return isRows(values)
    ? db.insert(projectFollowUps).values([...values]).onConflictDoUpdate(conflict)
    : db.insert(projectFollowUps).values(values).onConflictDoUpdate(conflict)
}

export async function upsertProjectFollowUp(
  db: Db,
  values: ProjectFollowUpInsert | readonly ProjectFollowUpInsert[],
  conflict: Upsert<ProjectFollowUpPatch>,
): Promise<D1Result> {
  return isRows(values)
    ? db.insert(projectFollowUps).values([...values]).onConflictDoUpdate(conflict).run()
    : db.insert(projectFollowUps).values(values).onConflictDoUpdate(conflict).run()
}

export function updateProjectFollowUpsStatement(db: Db, where: SQL | undefined, patch: ProjectFollowUpPatch): Statement {
  return db.update(projectFollowUps).set(patch).where(where)
}

export async function updateProjectFollowUps(db: Db, where: SQL | undefined, patch: ProjectFollowUpPatch): Promise<D1Result> {
  return db.update(projectFollowUps).set(patch).where(where).run()
}


export function deleteProjectFollowUpsStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectFollowUps).where(where)
}

export async function deleteProjectFollowUps(db: Db, where: SQL | undefined): Promise<D1Result> {
  return db.delete(projectFollowUps).where(where).run()
}


// ---- projectNotes

type ProjectNoteInsert = typeof projectNotes.$inferInsert
type ProjectNotePatch = SQLiteUpdateSetSource<typeof projectNotes>

export function insertProjectNoteStatement(db: Db, values: ProjectNoteInsert | readonly ProjectNoteInsert[]): Statement {
  return isRows(values) ? db.insert(projectNotes).values([...values]) : db.insert(projectNotes).values(values)
}

export async function insertProjectNote(db: Db, values: ProjectNoteInsert | readonly ProjectNoteInsert[]): Promise<D1Result> {
  return isRows(values) ? db.insert(projectNotes).values([...values]).run() : db.insert(projectNotes).values(values).run()
}

/** `ON CONFLICT DO NOTHING`, on `target` when given, else on any constraint. */
export function insertProjectNoteIfAbsentStatement(
  db: Db,
  values: ProjectNoteInsert | readonly ProjectNoteInsert[],
  target?: ConflictTarget,
): Statement {
  const config = target ? { target } : undefined
  return isRows(values)
    ? db.insert(projectNotes).values([...values]).onConflictDoNothing(config)
    : db.insert(projectNotes).values(values).onConflictDoNothing(config)
}

export async function insertProjectNoteIfAbsent(
  db: Db,
  values: ProjectNoteInsert | readonly ProjectNoteInsert[],
  target?: ConflictTarget,
): Promise<D1Result> {
  const config = target ? { target } : undefined
  return isRows(values)
    ? db.insert(projectNotes).values([...values]).onConflictDoNothing(config).run()
    : db.insert(projectNotes).values(values).onConflictDoNothing(config).run()
}

export function upsertProjectNoteStatement(
  db: Db,
  values: ProjectNoteInsert | readonly ProjectNoteInsert[],
  conflict: Upsert<ProjectNotePatch>,
): Statement {
  return isRows(values)
    ? db.insert(projectNotes).values([...values]).onConflictDoUpdate(conflict)
    : db.insert(projectNotes).values(values).onConflictDoUpdate(conflict)
}

export async function upsertProjectNote(
  db: Db,
  values: ProjectNoteInsert | readonly ProjectNoteInsert[],
  conflict: Upsert<ProjectNotePatch>,
): Promise<D1Result> {
  return isRows(values)
    ? db.insert(projectNotes).values([...values]).onConflictDoUpdate(conflict).run()
    : db.insert(projectNotes).values(values).onConflictDoUpdate(conflict).run()
}

export function updateProjectNotesStatement(db: Db, where: SQL | undefined, patch: ProjectNotePatch): Statement {
  return db.update(projectNotes).set(patch).where(where)
}

export async function updateProjectNotes(db: Db, where: SQL | undefined, patch: ProjectNotePatch): Promise<D1Result> {
  return db.update(projectNotes).set(patch).where(where).run()
}

/** The ids of the rows the update changed. */
export async function updateProjectNotesReturningIds(
  db: Db,
  where: SQL | undefined,
  patch: ProjectNotePatch,
): Promise<readonly { readonly id: string }[]> {
  return db.update(projectNotes).set(patch).where(where).returning({ id: projectNotes.id })
}

export function deleteProjectNotesStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectNotes).where(where)
}

export async function deleteProjectNotes(db: Db, where: SQL | undefined): Promise<D1Result> {
  return db.delete(projectNotes).where(where).run()
}

/** The ids of the rows the delete removed. */
export async function deleteProjectNotesReturningIds(
  db: Db,
  where: SQL | undefined,
): Promise<readonly { readonly id: string }[]> {
  return db.delete(projectNotes).where(where).returning({ id: projectNotes.id })
}
