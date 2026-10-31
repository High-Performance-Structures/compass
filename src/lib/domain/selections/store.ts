import { and, eq, type SQL } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"
import type { IndexColumn, SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core"

import { projectFinishSelectionRooms, projectFinishSelections } from "@/db/schema"
import { selectionDeletionAllowed } from "@/lib/selections/deletion"
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

// ---- named operations

/**
 * Deletes each selection whose deletion guard still holds at delete time, in
 * one batch. Returns the ids actually removed; a guarded row stays.
 */
export async function deleteRemovableSelections(
  db: Db,
  selectionIds: readonly string[],
): Promise<ReadonlySet<string>> {
  const statements = selectionIds.map((selectionId) =>
    db
      .delete(projectFinishSelections)
      .where(and(eq(projectFinishSelections.id, selectionId), selectionDeletionAllowed(selectionId)))
      .returning({ id: projectFinishSelections.id }),
  )
  const [first, ...rest] = statements
  if (!first) return new Set()
  const results = await db.batch([first, ...rest])
  return new Set(results.flatMap((rows) => rows.map((row) => row.id)))
}

/** A template-applied room row; an existing room with the same id is kept. */
export function templateSelectionRoomStatement(
  d1: D1Database,
  input: {
    readonly id: string
    readonly projectId: string
    readonly roomName: string
    readonly now: string
  },
): D1PreparedStatement {
  return d1
    .prepare(
      `INSERT OR IGNORE INTO project_finish_selection_rooms (
            id, project_id, source_system, room_name, sort_order,
            created_at, updated_at
          ) VALUES (?, ?, 'compass_template', ?, 1000, ?, ?)`
    )
    .bind(input.id, input.projectId, input.roomName, input.now, input.now)
}

/**
 * A template-applied finish selection. Imported choices need project-team
 * review before an owner can see them, so it starts hidden and unapproved.
 */
export function templateFinishSelectionStatement(
  d1: D1Database,
  input: {
    readonly id: string
    readonly projectId: string
    readonly sourceRecordId: string | null
    readonly roomName: string
    readonly category: string
    readonly name: string
    readonly description: string | null
    readonly costCode: string | null
    readonly status: string
    readonly notes: string | null
    readonly choiceOptionsJson: string | null
    readonly parentSelectionId: string | null
    readonly parentChoiceValue: string | null
    readonly selectionLevel: number
    readonly sortOrder: number
    readonly now: string
  },
): D1PreparedStatement {
  return d1
    .prepare(
      `INSERT INTO project_finish_selections (
            id, project_id, source_system, source_record_id, room_name,
            category, name, description, cost_code, status, owner_visible,
            owner_approved, notes, choice_options_json, parent_selection_id,
            parent_choice_value, selection_level, sort_order, sync_status,
            created_at, updated_at
          ) VALUES (?, ?, 'compass_template', ?, ?, ?, ?, ?, ?, ?, 0, 0,
            ?, ?, ?, ?, ?, ?, 'manual', ?, ?)`
    )
    .bind(
      input.id,
      input.projectId,
      input.sourceRecordId,
      input.roomName,
      input.category,
      input.name,
      input.description,
      input.costCode,
      input.status,
      input.notes,
      input.choiceOptionsJson,
      input.parentSelectionId,
      input.parentChoiceValue,
      input.selectionLevel,
      input.sortOrder,
      input.now,
      input.now
    )
}
