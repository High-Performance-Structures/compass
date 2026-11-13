import { and, eq, inArray, notInArray, sql, type SQL } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"
import type { IndexColumn, SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core"

import { projectFinishSelectionRooms, projectFinishSelections } from "@/db/schema"
import { selectionDeletionAllowed } from "@/lib/selections/deletion"
import type { Db } from "@/lib/server/action-context"
import { assertListFields } from "@/lib/shared/statuses"

import { insertCopyStatement } from "./copy-rows"
import { LOCKED_SELECTION_STATUSES, staffStatusChangeBlocker } from "./locks"
import { automaticSelectionStatus, selectionStatusSources, selectionStatusTarget, type SelectionStatusEvent } from "./status-machine"
import { PROJECT_SELECTION_STATUSES, SELECTION_REPLACEMENT_REASONS, type ProjectSelectionStatus, type SelectionReplacementReason } from "./statuses"

// Enumerated columns are checked against their shared list before every write.
const SELECTION_LISTS = { status: PROJECT_SELECTION_STATUSES, replacementReason: SELECTION_REPLACEMENT_REASONS }

/**
 * True while no other selection replaces the row being written. A replaced
 * selection stays on record as it was, so no status write touches it. The
 * outer table is named in full: inside the subquery a bare "id" would be the
 * replacement's.
 */
const notReplaced = sql`NOT EXISTS (SELECT 1 FROM project_finish_selections AS replacement WHERE replacement.replaces_selection_id = project_finish_selections.id)`

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

function isRows<T extends object>(values: T | readonly T[]): values is readonly T[] {
  return Array.isArray(values)
}

// ---- projectFinishSelectionRooms

type SelectionRoomInsert = typeof projectFinishSelectionRooms.$inferInsert
type SelectionRoomPatch = SQLiteUpdateSetSource<typeof projectFinishSelectionRooms>

export function insertSelectionRoomStatement(db: Db, values: SelectionRoomInsert | readonly SelectionRoomInsert[]): Statement {
  return isRows(values) ? db.insert(projectFinishSelectionRooms).values([...values]) : db.insert(projectFinishSelectionRooms).values(values)
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

export function updateSelectionRoomsStatement(db: Db, where: SQL | undefined, patch: SelectionRoomPatch): Statement {
  return db.update(projectFinishSelectionRooms).set(patch).where(where)
}

// ---- projectFinishSelections

type FinishSelectionInsert = typeof projectFinishSelections.$inferInsert
/** Every column but status; status changes through the status functions below. */
type FinishSelectionPatch = Omit<SQLiteUpdateSetSource<typeof projectFinishSelections>, "status">

// A spread or untyped patch can still carry status past the type; refuse it.
function withoutStatus(patch: FinishSelectionPatch): FinishSelectionPatch {
  if ("status" in patch) throw new Error("project_finish_selections.status changes only through the selections store's status functions.")
  return patch
}

export function insertFinishSelectionStatement(db: Db, values: FinishSelectionInsert | readonly FinishSelectionInsert[]): Statement {
  assertListFields("project_finish_selections", values, SELECTION_LISTS)
  return isRows(values) ? db.insert(projectFinishSelections).values([...values]) : db.insert(projectFinishSelections).values(values)
}

export async function insertFinishSelection(db: Db, values: FinishSelectionInsert | readonly FinishSelectionInsert[]): Promise<D1Result> {
  assertListFields("project_finish_selections", values, SELECTION_LISTS)
  return isRows(values) ? db.insert(projectFinishSelections).values([...values]).run() : db.insert(projectFinishSelections).values(values).run()
}

export function updateFinishSelectionsStatement(db: Db, where: SQL | undefined, patch: FinishSelectionPatch): Statement {
  return db.update(projectFinishSelections).set(withoutStatus(patch)).where(where)
}

/**
 * Plain column update; the number of rows written. `unlockedOnly`: lands
 * only on a row that is not ordered, installed or replaced at write time
 * (locks.ts), for edits that change the product.
 */
export async function updateFinishSelections(
  db: Db,
  where: SQL | undefined,
  patch: FinishSelectionPatch,
  options: { readonly unlockedOnly?: boolean } = {},
): Promise<number> {
  const guarded = options.unlockedOnly ? and(where, unlockedSelection) : where
  const result = await db.update(projectFinishSelections).set(withoutStatus(patch)).where(guarded).run()
  return result.meta.changes
}

// ---- selection status (issue #1329, phase 2)
//
// Staff set any status by hand (setSelectionStatusByStaff); Compass's own
// moves follow status-machine.ts. Both are compare-and-set, so a stale read
// never overwrites a newer status. Every other update leaves status out.

/** True while the row is neither ordered nor installed, and nothing replaces it. */
const unlockedSelection = and(notInArray(projectFinishSelections.status, [...LOCKED_SELECTION_STATUSES]), notReplaced)

/**
 * A staff status change: lands only while the selection still has
 * `expected`, the status the person saw, and no selection replaces it.
 * False when that changed meanwhile. Throws when the move is locked: an
 * installed selection does not move, an ordered one only on to Installed.
 */
export async function setSelectionStatusByStaff(
  db: Db,
  input: {
    readonly projectId: string
    readonly selectionId: string
    readonly expected: string
    readonly status: ProjectSelectionStatus
    /** Other columns written with the status. */
    readonly values?: FinishSelectionPatch
  },
): Promise<boolean> {
  const blocker = staffStatusChangeBlocker(input.expected, input.status, false)
  if (blocker) throw new Error(blocker)
  const values = { ...withoutStatus(input.values ?? {}), status: input.status }
  assertListFields("project_finish_selections", values, SELECTION_LISTS)
  const result = await db
    .update(projectFinishSelections)
    .set(values)
    .where(
      and(
        eq(projectFinishSelections.id, input.selectionId),
        eq(projectFinishSelections.projectId, input.projectId),
        // The stored value may be off the list (an old spelling), so compare as text.
        sql`${projectFinishSelections.status} = ${input.expected}`,
        notReplaced,
      ),
    )
    .run()
  return result.meta.changes > 0
}

// Return type left to Drizzle: run() and the batch both need the builder.
/**
 * An automatic move of one selection read as `stored`, for the caller's
 * batch: lands only while the row still has `stored` (one of the event's
 * source statuses) and returns its id. Null when the machine doesn't move a
 * selection from `stored` at all.
 */
export function automaticSelectionStatusStatement(
  db: Db,
  move: {
    readonly projectId: string
    readonly selectionId: string
    readonly event: SelectionStatusEvent
    readonly stored: string
    readonly values?: FinishSelectionPatch
  },
) {
  const to = automaticSelectionStatus(move.event, move.stored)
  if (to === null) return null
  return db
    .update(projectFinishSelections)
    .set({ ...withoutStatus(move.values ?? {}), status: to })
    .where(
      and(
        eq(projectFinishSelections.id, move.selectionId),
        eq(projectFinishSelections.projectId, move.projectId),
        sql`${projectFinishSelections.status} = ${move.stored}`,
        notReplaced,
      ),
    )
    .returning({ id: projectFinishSelections.id })
}

/**
 * `event`'s status as a column expression: the event's target where the row
 * is in one of its source statuses at write time (and not replaced),
 * otherwise unchanged. For writes whose other columns land regardless (a
 * signature records the approval even on an ordered selection; a reopen
 * clears it everywhere).
 */
function statusAfterEvent(event: SelectionStatusEvent): SQL {
  const to = selectionStatusTarget(event)
  return sql`CASE WHEN ${inArray(projectFinishSelections.status, [...selectionStatusSources(event)])} AND ${notReplaced} THEN ${to} ELSE ${projectFinishSelections.status} END`
}

/** Columns plus `event`'s status move (see statusAfterEvent), as a batch statement. */
export function updateFinishSelectionsWithEventStatement(
  db: Db,
  where: SQL | undefined,
  event: SelectionStatusEvent,
  patch: FinishSelectionPatch,
): Statement {
  return db
    .update(projectFinishSelections)
    .set({ ...withoutStatus(patch), status: statusAfterEvent(event) })
    .where(where)
}

/** Columns plus `event`'s status move (see statusAfterEvent). */
export async function updateFinishSelectionsWithEvent(
  db: Db,
  where: SQL | undefined,
  event: SelectionStatusEvent,
  patch: FinishSelectionPatch,
): Promise<D1Result> {
  return db
    .update(projectFinishSelections)
    .set({ ...withoutStatus(patch), status: statusAfterEvent(event) })
    .where(where)
    .run()
}

/**
 * A new selection replacing `input.replacesSelectionId`, as one statement for
 * the caller's batch: copied from that row (room, name, category, quantity,
 * cost and phase codes, follow-up links, order) only while it still has
 * `input.expected` and nothing replaces it yet. The old product fields are
 * left off: the new pick is a different product, carried by its choice. It
 * starts hidden from the owner, unapproved and outside any Selection Phase
 * (its change order is its owner signature). The unique index on
 * replaces_selection_id allows one replacement per selection.
 */
export function insertReplacementSelectionStatement(
  db: Db,
  input: {
    readonly id: string
    readonly projectId: string
    readonly replacesSelectionId: string
    readonly expected: string
    readonly reason: SelectionReplacementReason
    readonly status: ProjectSelectionStatus
    readonly notes: string | null
    readonly now: string
  },
): Statement {
  assertListFields("project_finish_selections", { status: input.status, replacementReason: input.reason }, SELECTION_LISTS)
  return insertCopyStatement(
    db,
    projectFinishSelections,
    {
      id: input.id,
      sourceSystem: "compass",
      sourceRecordId: null,
      sourceWorkbookId: null,
      sourceSheetName: null,
      manufacturer: null,
      model: null,
      colorFinish: null,
      choiceOptionsJson: null,
      supplierName: null,
      productUrl: null,
      status: input.status,
      ownerVisible: false,
      ownerApproved: false,
      approvedBy: null,
      approvedAt: null,
      rfqOperationId: null,
      purchaseOrderOperationId: null,
      notes: input.notes,
      roundKey: null,
      syncStatus: "manual",
      lastSyncedAt: null,
      replacesSelectionId: input.replacesSelectionId,
      replacementReason: input.reason,
      replacementPricedChoiceId: null,
      createdAt: input.now,
      updatedAt: input.now,
    },
    and(
      eq(projectFinishSelections.id, input.replacesSelectionId),
      eq(projectFinishSelections.projectId, input.projectId),
      sql`${projectFinishSelections.status} = ${input.expected}`,
      notReplaced,
    ),
  )
}

/**
 * An allowed edit of a locked (ordered or installed) selection: room, room
 * type or notes. Lands only while the row still has `expected` and nothing
 * replaces it. Its published decision stays current: a room move isn't a
 * product change (specificationCurrent). False when nothing landed.
 */
export async function updateLockedSelection(
  db: Db,
  input: {
    readonly projectId: string
    readonly selectionId: string
    readonly expected: string
    readonly values: FinishSelectionPatch
  },
): Promise<boolean> {
  const result = await db
    .update(projectFinishSelections)
    .set(withoutStatus(input.values))
    .where(
      and(
        eq(projectFinishSelections.id, input.selectionId),
        eq(projectFinishSelections.projectId, input.projectId),
        sql`${projectFinishSelections.status} = ${input.expected}`,
        notReplaced,
      ),
    )
    .run()
  return result.meta.changes > 0
}

/** Records the choice a replacement's change order is priced for (null: none yet). */
export async function setReplacementPricedChoice(
  db: Db,
  input: { readonly projectId: string; readonly selectionId: string; readonly choiceId: string | null },
): Promise<void> {
  await db
    .update(projectFinishSelections)
    .set({ replacementPricedChoiceId: input.choiceId })
    .where(and(eq(projectFinishSelections.id, input.selectionId), eq(projectFinishSelections.projectId, input.projectId)))
    .run()
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
    readonly status: ProjectSelectionStatus
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
