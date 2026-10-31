import type { SQL } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"
import type { IndexColumn, SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core"

import { projectFinishSelectionRooms, projectFinishSelections } from "@/db/schema"
import type { Db } from "@/lib/server/action-context"

/*
 * The only code that inserts, updates or deletes project finish selections and their rooms
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

// ---- projectFinishSelectionRooms

type SelectionRoomInsert = typeof projectFinishSelectionRooms.$inferInsert
type SelectionRoomPatch = SQLiteUpdateSetSource<typeof projectFinishSelectionRooms>

export function insertSelectionRoomStatement(db: Db, values: SelectionRoomInsert | readonly SelectionRoomInsert[]): Statement {
  return isRows(values) ? db.insert(projectFinishSelectionRooms).values([...values]) : db.insert(projectFinishSelectionRooms).values(values)
}

export async function insertSelectionRoom(db: Db, values: SelectionRoomInsert | readonly SelectionRoomInsert[]): Promise<D1Result> {
  return isRows(values) ? db.insert(projectFinishSelectionRooms).values([...values]).run() : db.insert(projectFinishSelectionRooms).values(values).run()
}

/** `ON CONFLICT DO NOTHING`, on `target` when given, else on any constraint. */
export function insertSelectionRoomIfAbsentStatement(
  db: Db,
  values: SelectionRoomInsert | readonly SelectionRoomInsert[],
  target?: ConflictTarget,
): Statement {
  const config = target ? { target } : undefined
  return isRows(values)
    ? db.insert(projectFinishSelectionRooms).values([...values]).onConflictDoNothing(config)
    : db.insert(projectFinishSelectionRooms).values(values).onConflictDoNothing(config)
}

export async function insertSelectionRoomIfAbsent(
  db: Db,
  values: SelectionRoomInsert | readonly SelectionRoomInsert[],
  target?: ConflictTarget,
): Promise<D1Result> {
  const config = target ? { target } : undefined
  return isRows(values)
    ? db.insert(projectFinishSelectionRooms).values([...values]).onConflictDoNothing(config).run()
    : db.insert(projectFinishSelectionRooms).values(values).onConflictDoNothing(config).run()
}

export function upsertSelectionRoomStatement(
  db: Db,
  values: SelectionRoomInsert | readonly SelectionRoomInsert[],
  conflict: Upsert<SelectionRoomPatch>,
): Statement {
  return isRows(values)
    ? db.insert(projectFinishSelectionRooms).values([...values]).onConflictDoUpdate(conflict)
    : db.insert(projectFinishSelectionRooms).values(values).onConflictDoUpdate(conflict)
}

export async function upsertSelectionRoom(
  db: Db,
  values: SelectionRoomInsert | readonly SelectionRoomInsert[],
  conflict: Upsert<SelectionRoomPatch>,
): Promise<D1Result> {
  return isRows(values)
    ? db.insert(projectFinishSelectionRooms).values([...values]).onConflictDoUpdate(conflict).run()
    : db.insert(projectFinishSelectionRooms).values(values).onConflictDoUpdate(conflict).run()
}

export function updateSelectionRoomsStatement(db: Db, where: SQL | undefined, patch: SelectionRoomPatch): Statement {
  return db.update(projectFinishSelectionRooms).set(patch).where(where)
}

export async function updateSelectionRooms(db: Db, where: SQL | undefined, patch: SelectionRoomPatch): Promise<D1Result> {
  return db.update(projectFinishSelectionRooms).set(patch).where(where).run()
}

/** The ids of the rows the update changed. */
export async function updateSelectionRoomsReturningIds(
  db: Db,
  where: SQL | undefined,
  patch: SelectionRoomPatch,
): Promise<readonly { readonly id: string }[]> {
  return db.update(projectFinishSelectionRooms).set(patch).where(where).returning({ id: projectFinishSelectionRooms.id })
}

export function deleteSelectionRoomsStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectFinishSelectionRooms).where(where)
}

export async function deleteSelectionRooms(db: Db, where: SQL | undefined): Promise<D1Result> {
  return db.delete(projectFinishSelectionRooms).where(where).run()
}

/** The ids of the rows the delete removed. */
export async function deleteSelectionRoomsReturningIds(
  db: Db,
  where: SQL | undefined,
): Promise<readonly { readonly id: string }[]> {
  return db.delete(projectFinishSelectionRooms).where(where).returning({ id: projectFinishSelectionRooms.id })
}

// ---- projectFinishSelections

type FinishSelectionInsert = typeof projectFinishSelections.$inferInsert
type FinishSelectionPatch = SQLiteUpdateSetSource<typeof projectFinishSelections>

export function insertFinishSelectionStatement(db: Db, values: FinishSelectionInsert | readonly FinishSelectionInsert[]): Statement {
  return isRows(values) ? db.insert(projectFinishSelections).values([...values]) : db.insert(projectFinishSelections).values(values)
}

export async function insertFinishSelection(db: Db, values: FinishSelectionInsert | readonly FinishSelectionInsert[]): Promise<D1Result> {
  return isRows(values) ? db.insert(projectFinishSelections).values([...values]).run() : db.insert(projectFinishSelections).values(values).run()
}

/** `ON CONFLICT DO NOTHING`, on `target` when given, else on any constraint. */
export function insertFinishSelectionIfAbsentStatement(
  db: Db,
  values: FinishSelectionInsert | readonly FinishSelectionInsert[],
  target?: ConflictTarget,
): Statement {
  const config = target ? { target } : undefined
  return isRows(values)
    ? db.insert(projectFinishSelections).values([...values]).onConflictDoNothing(config)
    : db.insert(projectFinishSelections).values(values).onConflictDoNothing(config)
}

export async function insertFinishSelectionIfAbsent(
  db: Db,
  values: FinishSelectionInsert | readonly FinishSelectionInsert[],
  target?: ConflictTarget,
): Promise<D1Result> {
  const config = target ? { target } : undefined
  return isRows(values)
    ? db.insert(projectFinishSelections).values([...values]).onConflictDoNothing(config).run()
    : db.insert(projectFinishSelections).values(values).onConflictDoNothing(config).run()
}

export function upsertFinishSelectionStatement(
  db: Db,
  values: FinishSelectionInsert | readonly FinishSelectionInsert[],
  conflict: Upsert<FinishSelectionPatch>,
): Statement {
  return isRows(values)
    ? db.insert(projectFinishSelections).values([...values]).onConflictDoUpdate(conflict)
    : db.insert(projectFinishSelections).values(values).onConflictDoUpdate(conflict)
}

export async function upsertFinishSelection(
  db: Db,
  values: FinishSelectionInsert | readonly FinishSelectionInsert[],
  conflict: Upsert<FinishSelectionPatch>,
): Promise<D1Result> {
  return isRows(values)
    ? db.insert(projectFinishSelections).values([...values]).onConflictDoUpdate(conflict).run()
    : db.insert(projectFinishSelections).values(values).onConflictDoUpdate(conflict).run()
}

export function updateFinishSelectionsStatement(db: Db, where: SQL | undefined, patch: FinishSelectionPatch): Statement {
  return db.update(projectFinishSelections).set(patch).where(where)
}

export async function updateFinishSelections(db: Db, where: SQL | undefined, patch: FinishSelectionPatch): Promise<D1Result> {
  return db.update(projectFinishSelections).set(patch).where(where).run()
}

/** The ids of the rows the update changed. */
export async function updateFinishSelectionsReturningIds(
  db: Db,
  where: SQL | undefined,
  patch: FinishSelectionPatch,
): Promise<readonly { readonly id: string }[]> {
  return db.update(projectFinishSelections).set(patch).where(where).returning({ id: projectFinishSelections.id })
}

export function deleteFinishSelectionsStatement(db: Db, where: SQL | undefined): Statement {
  return db.delete(projectFinishSelections).where(where)
}

export async function deleteFinishSelections(db: Db, where: SQL | undefined): Promise<D1Result> {
  return db.delete(projectFinishSelections).where(where).run()
}

/** The ids of the rows the delete removed. */
export async function deleteFinishSelectionsReturningIds(
  db: Db,
  where: SQL | undefined,
): Promise<readonly { readonly id: string }[]> {
  return db.delete(projectFinishSelections).where(where).returning({ id: projectFinishSelections.id })
}
