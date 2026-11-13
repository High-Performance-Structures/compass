/**
 * Room edits on a job's finish schedule: add an empty room, rename or retype
 * a room, delete it, put rooms in order, duplicate a room, and duplicate or
 * move one selection (owner decision 2026-11-13). A room is identified by its
 * name: selections carry the room name, and a room row (when there is one)
 * holds its type, order and workbook source. Writes go through store.ts and
 * choices-store.ts; callers resolve staff access first.
 *
 * - A rename or reorder marks the room staff-edited, so a workbook re-import
 *   keeps the Compass name, type and order (finish-schedule-import.ts).
 * - A delete refuses while any selection in the room is approved, signed,
 *   out for signature, ordered, installed or replaced (the same rules as
 *   deleting one selection, checked again inside each delete). A deleted
 *   workbook room stays as a row marked deleted, so a re-import leaves it out.
 * - A duplicate copies the products, choices (none picked), supplier links,
 *   photos and follow-up links as new, undecided selections. Replaced
 *   selections stay on record and are never copied.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm"

import { projectFinishSelectionRooms, projectFinishSelections } from "@/db/schema"
import {
  projectSelectionChoiceDependents,
  projectSelectionChoices,
  projectSelectionLinks,
  projectSelectionPhotos,
} from "@/db/schema-selection-choices"
import type { Db } from "@/lib/server/action-context"

import { copyChoicesToReplacementStatements, relinkDuplicatedDependentsStatements } from "./choices-store"
import { selectionLock } from "./locks"
import {
  copyFinishSelectionStatement,
  deleteRemovableSelections,
  deleteSelectionRoomsStatement,
  insertSelectionRoomStatement,
  updateFinishSelectionsStatement,
  updateSelectionRoomsStatement,
  type Statement,
} from "./store"
import { loadProjectSelections } from "./workspace"

export type RoomEditResult = { readonly ok: true } | { readonly ok: false; readonly error: string }

const MAX_ROOM_NAME = 120
// D1 allows 100 bound values per statement.
const ID_CHUNK = 90

function chunks<T>(items: readonly T[]): T[][] {
  return Array.from({ length: Math.ceil(items.length / ID_CHUNK) }, (_, index) => items.slice(index * ID_CHUNK, index * ID_CHUNK + ID_CHUNK))
}

/** Trimmed, single-spaced room text, or null when blank. */
export function cleanRoomName(value: string | null | undefined): string | null {
  const name = (value ?? "").replace(/\s+/g, " ").trim()
  return name ? name.slice(0, MAX_ROOM_NAME) : null
}

function sameRoom(left: string, right: string): boolean {
  return left.toLocaleLowerCase() === right.toLocaleLowerCase()
}

async function runBatch(db: Db, statements: readonly Statement[]): Promise<void> {
  const [first, ...rest] = statements
  if (first) await db.batch([first, ...rest])
}

/** The job's rooms in their shown order (rows and room names on selections). */
async function currentRooms(db: Db, projectId: string): Promise<readonly { readonly roomName: string; readonly roomType: string | null; readonly sortOrder: number }[]> {
  const summary = await loadProjectSelections(db, projectId)
  return summary.rooms
}

function nameTaken(rooms: readonly { readonly roomName: string }[], name: string, except?: string): boolean {
  return rooms.some((room) => sameRoom(room.roomName, name) && !(except !== undefined && sameRoom(room.roomName, except)))
}

function roomTakenError(name: string): RoomEditResult {
  return { ok: false, error: `There is already a room named "${name}". Choose another name, or move the selections into that room.` }
}

/** The room's rows (a job can have more than one row with the same name). */
function roomRowsWhere(projectId: string, roomName: string): ReturnType<typeof and> {
  return and(
    eq(projectFinishSelectionRooms.projectId, projectId),
    eq(projectFinishSelectionRooms.roomName, roomName),
    eq(projectFinishSelectionRooms.active, true),
  )
}

async function roomHasRow(db: Db, projectId: string, roomName: string): Promise<boolean> {
  const [row] = await db
    .select({ id: projectFinishSelectionRooms.id })
    .from(projectFinishSelectionRooms)
    .where(roomRowsWhere(projectId, roomName))
    .limit(1)
  return row !== undefined
}

function newRoomRow(db: Db, input: { readonly projectId: string; readonly roomName: string; readonly roomType: string | null; readonly sortOrder: number; readonly now: string }): Statement {
  return insertSelectionRoomStatement(db, {
    id: crypto.randomUUID(),
    projectId: input.projectId,
    sourceSystem: "compass",
    roomName: input.roomName,
    roomType: input.roomType,
    sortOrder: input.sortOrder,
    active: true,
    staffEditedAt: input.now,
    createdAt: input.now,
    updatedAt: input.now,
  })
}

/** Adds an empty room at the end of the schedule. */
export async function addSelectionRoom(
  db: Db,
  projectId: string,
  input: { readonly roomName: string | null; readonly roomType: string | null },
): Promise<RoomEditResult> {
  const roomName = cleanRoomName(input.roomName)
  if (!roomName) return { ok: false, error: "Enter a room name." }
  const rooms = await currentRooms(db, projectId)
  if (nameTaken(rooms, roomName)) return roomTakenError(roomName)
  const last = rooms.reduce((highest, room) => Math.max(highest, room.sortOrder), 0)
  await runBatch(db, [newRoomRow(db, { projectId, roomName, roomType: cleanRoomName(input.roomType), sortOrder: last + 1, now: new Date().toISOString() })])
  return { ok: true }
}

/**
 * Renames or retypes a room: its rows and every selection in it follow. A
 * room move isn't a product change, so published selections stay current.
 */
export async function renameSelectionRoom(
  db: Db,
  projectId: string,
  input: { readonly fromName: string; readonly roomName: string | null; readonly roomType: string | null },
): Promise<RoomEditResult> {
  const roomName = cleanRoomName(input.roomName)
  if (!roomName) return { ok: false, error: "Enter a room name." }
  const roomType = cleanRoomName(input.roomType)
  const rooms = await currentRooms(db, projectId)
  const room = rooms.find((candidate) => candidate.roomName === input.fromName)
  if (!room) return { ok: false, error: "That room is no longer on this job. Refresh the page." }
  if (nameTaken(rooms, roomName, input.fromName)) return roomTakenError(roomName)
  const now = new Date().toISOString()
  const statements: Statement[] = [
    updateFinishSelectionsStatement(
      db,
      and(eq(projectFinishSelections.projectId, projectId), eq(projectFinishSelections.roomName, input.fromName)),
      { roomName, roomType, updatedAt: now },
    ),
  ]
  if (await roomHasRow(db, projectId, input.fromName)) {
    statements.push(updateSelectionRoomsStatement(db, roomRowsWhere(projectId, input.fromName), { roomName, roomType, staffEditedAt: now, updatedAt: now }))
  } else {
    statements.push(newRoomRow(db, { projectId, roomName, roomType, sortOrder: room.sortOrder, now }))
  }
  await runBatch(db, statements)
  return { ok: true }
}

/** Why a selection keeps its room from being deleted, or null. */
function deleteBlocker(row: { readonly status: string; readonly ownerApproved: boolean; readonly replaced: boolean }): string | null {
  if (selectionLock(row.status, row.replaced)) return "ordered, installed or replaced"
  if (row.ownerApproved || row.status === "approved") return "approved"
  return null
}

/**
 * Deletes a room and its selections. Refused while any selection in it must
 * stay on record; the per-row deletion guard runs again inside each delete.
 */
export async function deleteSelectionRoom(db: Db, projectId: string, roomName: string): Promise<RoomEditResult> {
  const selections = await db
    .select({
      id: projectFinishSelections.id,
      name: projectFinishSelections.name,
      status: projectFinishSelections.status,
      ownerApproved: projectFinishSelections.ownerApproved,
      replaced: sql<number>`EXISTS (SELECT 1 FROM project_finish_selections AS replacement WHERE replacement.replaces_selection_id = ${projectFinishSelections.id})`,
    })
    .from(projectFinishSelections)
    .where(and(eq(projectFinishSelections.projectId, projectId), eq(projectFinishSelections.roomName, roomName)))
  const blocked = selections.filter((row) => deleteBlocker({ ...row, replaced: Boolean(row.replaced) }) !== null)
  if (blocked.length > 0) {
    const names = blocked.slice(0, 3).map((row) => `"${row.name}"`).join(", ")
    const more = blocked.length > 3 ? ` and ${blocked.length - 3} more` : ""
    return {
      ok: false,
      error: `${roomName} can't be deleted: ${names}${more} ${blocked.length === 1 ? "is" : "are"} approved, ordered, installed or replaced and must stay on record. Move ${blocked.length === 1 ? "it" : "them"} to another room first, or use a change order.`,
    }
  }
  const removed = await deleteRemovableSelections(db, selections.map((row) => row.id))
  const kept = selections.length - removed.size
  if (kept > 0) {
    return {
      ok: false,
      error: `${removed.size} of ${selections.length} selections were deleted. ${kept} ${kept === 1 ? "has" : "have"} owner requests, owner comments, purchase links or a Selection Phase out for signature, so ${roomName} stays. Handle those first, then delete the room.`,
    }
  }
  const now = new Date().toISOString()
  const empty = sql`NOT EXISTS (SELECT 1 FROM project_finish_selections AS left_behind WHERE left_behind.project_id = ${projectId} AND left_behind.room_name = ${roomName})`
  await runBatch(db, [
    // A workbook room is kept, marked deleted, so a re-import leaves it out.
    updateSelectionRoomsStatement(
      db,
      and(roomRowsWhere(projectId, roomName), eq(projectFinishSelectionRooms.sourceSystem, "google_sheets"), empty),
      { active: false, deletedAt: now, updatedAt: now },
    ),
    deleteSelectionRoomsStatement(db, and(roomRowsWhere(projectId, roomName), sql`${projectFinishSelectionRooms.sourceSystem} <> 'google_sheets'`, empty)),
  ])
  return { ok: true }
}

/** Puts the job's rooms in `roomNames` order (every room, top to bottom). */
export async function reorderSelectionRooms(db: Db, projectId: string, roomNames: readonly string[]): Promise<RoomEditResult> {
  const rooms = await currentRooms(db, projectId)
  const sameRooms =
    roomNames.length === rooms.length &&
    new Set(roomNames).size === roomNames.length &&
    roomNames.every((name) => rooms.some((room) => room.roomName === name))
  if (!sameRooms) return { ok: false, error: "The rooms changed since this page loaded. Refresh the page and try again." }
  const rows = await db
    .select({ roomName: projectFinishSelectionRooms.roomName })
    .from(projectFinishSelectionRooms)
    .where(and(eq(projectFinishSelectionRooms.projectId, projectId), eq(projectFinishSelectionRooms.active, true)))
  const withRow = new Set(rows.map((row) => row.roomName))
  const now = new Date().toISOString()
  const statements = roomNames.map((roomName, index) => {
    const sortOrder = index + 1
    if (withRow.has(roomName)) {
      return updateSelectionRoomsStatement(db, roomRowsWhere(projectId, roomName), { sortOrder, staffEditedAt: now, updatedAt: now })
    }
    const room = rooms.find((candidate) => candidate.roomName === roomName)
    return newRoomRow(db, { projectId, roomName, roomType: room?.roomType ?? null, sortOrder, now })
  })
  await runBatch(db, statements)
  return { ok: true }
}

type CopySource = {
  readonly id: string
  readonly name: string
  readonly parentSelectionId: string | null
}

/** The copy statements for `sources` (choices, links, photos and follow-ups included). */
async function copySelectionsStatements(
  db: Db,
  input: {
    readonly projectId: string
    readonly sources: readonly CopySource[]
    readonly roomName: string
    readonly roomType: string | null
    readonly rename: (name: string) => string
    readonly now: string
  },
): Promise<{ readonly statements: readonly Statement[]; readonly copied: number }> {
  const sourceIds = input.sources.map((source) => source.id)
  const { choices, links, photos } = await readChildren(db, sourceIds)
  const newIds = new Map(input.sources.map((source) => [source.id, crypto.randomUUID()]))
  const newChoiceIds = new Map(choices.map((choice) => [choice.id, crypto.randomUUID()]))
  const statements: Statement[] = []
  for (const source of input.sources) {
    const newId = newIds.get(source.id)
    if (!newId) continue
    // A follow-up copied with its parent hangs under the parent's copy.
    const parentCopy = source.parentSelectionId ? newIds.get(source.parentSelectionId) : undefined
    statements.push(
      copyFinishSelectionStatement(db, {
        id: newId,
        projectId: input.projectId,
        fromSelectionId: source.id,
        roomName: input.roomName,
        roomType: input.roomType,
        name: input.rename(source.name),
        parentSelectionId: parentCopy ?? source.parentSelectionId,
        now: input.now,
      }),
      ...copyChoicesToReplacementStatements(db, {
        projectId: input.projectId,
        fromSelectionId: source.id,
        toSelectionId: newId,
        choices: choices.filter((choice) => choice.selectionId === source.id).map((choice) => ({ fromId: choice.id, newId: newChoiceIds.get(choice.id) ?? crypto.randomUUID() })),
        links: links.filter((link) => link.selectionId === source.id).map((link) => ({ fromId: link.id, newId: crypto.randomUUID(), newChoiceId: link.choiceId ? (newChoiceIds.get(link.choiceId) ?? null) : null })),
        photos: photos.filter((photo) => photo.selectionId === source.id).map((photo) => ({ fromId: photo.id, newId: crypto.randomUUID(), newChoiceId: photo.choiceId ? (newChoiceIds.get(photo.choiceId) ?? null) : null })),
        pick: null,
        now: input.now,
      }),
    )
  }
  if (input.sources.length > 1) {
    statements.push(
      ...relinkDuplicatedDependentsStatements(db, {
        pairs: input.sources.flatMap((source) => {
          const newId = newIds.get(source.id)
          return newId ? [{ fromId: source.id, newId }] : []
        }),
        fromChoiceIds: [...newChoiceIds.keys()],
        newChoiceIds: [...newChoiceIds.values()],
      }),
    )
  }
  return { statements, copied: input.sources.length }
}

type ChildRow = { readonly id: string; readonly selectionId: string; readonly choiceId: string | null }

/** The choices, supplier links and photos of `selectionIds`, read in chunks. */
async function readChildren(
  db: Db,
  selectionIds: readonly string[],
): Promise<{ readonly choices: readonly ChildRow[]; readonly links: readonly ChildRow[]; readonly photos: readonly ChildRow[] }> {
  const choices: ChildRow[] = []
  const links: ChildRow[] = []
  const photos: ChildRow[] = []
  for (const ids of chunks(selectionIds)) {
    const [choiceRows, linkRows, photoRows] = await Promise.all([
      db
        .select({ id: projectSelectionChoices.id, selectionId: projectSelectionChoices.selectionId })
        .from(projectSelectionChoices)
        .where(inArray(projectSelectionChoices.selectionId, ids))
        .orderBy(asc(projectSelectionChoices.sortOrder)),
      db
        .select({ id: projectSelectionLinks.id, selectionId: projectSelectionLinks.selectionId, choiceId: projectSelectionLinks.choiceId })
        .from(projectSelectionLinks)
        .where(inArray(projectSelectionLinks.selectionId, ids)),
      db
        .select({ id: projectSelectionPhotos.id, selectionId: projectSelectionPhotos.selectionId, choiceId: projectSelectionPhotos.choiceId })
        .from(projectSelectionPhotos)
        .where(inArray(projectSelectionPhotos.selectionId, ids)),
    ])
    choices.push(...choiceRows.map((row) => ({ ...row, choiceId: null })))
    links.push(...linkRows)
    photos.push(...photoRows)
  }
  return { choices, links, photos }
}

/** Selections in a room that may be copied: everything not replaced by another selection. */
async function copyableSelections(db: Db, projectId: string, where: ReturnType<typeof and>): Promise<readonly CopySource[]> {
  return db
    .select({ id: projectFinishSelections.id, name: projectFinishSelections.name, parentSelectionId: projectFinishSelections.parentSelectionId })
    .from(projectFinishSelections)
    .where(
      and(
        eq(projectFinishSelections.projectId, projectId),
        where,
        sql`NOT EXISTS (SELECT 1 FROM project_finish_selections AS replacement WHERE replacement.replaces_selection_id = ${projectFinishSelections.id})`,
      ),
    )
    .orderBy(asc(projectFinishSelections.sortOrder), asc(projectFinishSelections.name))
}

/** Copies a room under a new name, right after it, with new undecided selections. */
export async function duplicateSelectionRoom(
  db: Db,
  projectId: string,
  input: { readonly fromName: string; readonly roomName: string | null; readonly roomType: string | null },
): Promise<RoomEditResult & { readonly copied?: number }> {
  const roomName = cleanRoomName(input.roomName)
  if (!roomName) return { ok: false, error: "Enter a name for the new room." }
  const rooms = await currentRooms(db, projectId)
  const source = rooms.find((room) => room.roomName === input.fromName)
  if (!source) return { ok: false, error: "That room is no longer on this job. Refresh the page." }
  if (nameTaken(rooms, roomName)) return roomTakenError(roomName)
  const roomType = cleanRoomName(input.roomType) ?? source.roomType
  const now = new Date().toISOString()
  const sources = await copyableSelections(db, projectId, eq(projectFinishSelections.roomName, input.fromName))
  const copy = await copySelectionsStatements(db, { projectId, sources, roomName, roomType, rename: (name) => name, now })
  // The copy sits right after the original (same order number; names break the tie).
  await runBatch(db, [newRoomRow(db, { projectId, roomName, roomType, sortOrder: source.sortOrder, now }), ...copy.statements])
  return { ok: true, copied: copy.copied }
}

/** Copies one selection in its room as a new, undecided selection named "… (copy)". */
export async function duplicateSelection(db: Db, projectId: string, selectionId: string): Promise<RoomEditResult> {
  const [row] = await db
    .select({ roomName: projectFinishSelections.roomName, roomType: projectFinishSelections.roomType })
    .from(projectFinishSelections)
    .where(and(eq(projectFinishSelections.projectId, projectId), eq(projectFinishSelections.id, selectionId)))
    .limit(1)
  if (!row) return { ok: false, error: "Selection not found." }
  const sources = await copyableSelections(db, projectId, eq(projectFinishSelections.id, selectionId))
  if (sources.length === 0) return { ok: false, error: "This selection was replaced and stays on record as it was. Duplicate its replacement instead." }
  const copy = await copySelectionsStatements(db, {
    projectId,
    sources,
    roomName: row.roomName,
    roomType: row.roomType,
    rename: (name) => `${name} (copy)`.slice(0, 200),
    now: new Date().toISOString(),
  })
  await runBatch(db, copy.statements)
  return { ok: true }
}

/**
 * Moves a selection, with the follow-ups its choices open, to another room
 * (made if it doesn't exist yet). A move doesn't change the pick, so it is
 * allowed on approved, ordered and installed selections; a replaced one
 * stays where it was.
 */
export async function moveSelectionToRoom(
  db: Db,
  projectId: string,
  input: { readonly selectionId: string; readonly roomName: string | null },
): Promise<RoomEditResult> {
  const roomName = cleanRoomName(input.roomName)
  if (!roomName) return { ok: false, error: "Choose a room." }
  const [row] = await db
    .select({
      roomName: projectFinishSelections.roomName,
      replaced: sql<number>`EXISTS (SELECT 1 FROM project_finish_selections AS replacement WHERE replacement.replaces_selection_id = ${projectFinishSelections.id})`,
    })
    .from(projectFinishSelections)
    .where(and(eq(projectFinishSelections.projectId, projectId), eq(projectFinishSelections.id, input.selectionId)))
    .limit(1)
  if (!row) return { ok: false, error: "Selection not found." }
  if (row.replaced) return { ok: false, error: "This selection was replaced and stays on record as it was. Move its replacement instead." }
  const rooms = await currentRooms(db, projectId)
  const target = rooms.find((room) => sameRoom(room.roomName, roomName))
  const targetName = target?.roomName ?? roomName
  if (targetName === row.roomName) return { ok: true }
  const now = new Date().toISOString()
  const followUps = sql`${projectFinishSelections.id} IN (SELECT dependent.selection_id FROM ${projectSelectionChoiceDependents} AS dependent INNER JOIN ${projectSelectionChoices} AS opener ON opener.id = dependent.choice_id WHERE opener.selection_id = ${input.selectionId})`
  const statements: Statement[] = [
    updateFinishSelectionsStatement(
      db,
      and(
        eq(projectFinishSelections.projectId, projectId),
        eq(projectFinishSelections.roomName, row.roomName),
        sql`(${projectFinishSelections.id} = ${input.selectionId} OR ${projectFinishSelections.parentSelectionId} = ${input.selectionId} OR ${followUps})`,
        sql`NOT EXISTS (SELECT 1 FROM project_finish_selections AS replacement WHERE replacement.replaces_selection_id = ${projectFinishSelections.id})`,
      ),
      { roomName: targetName, roomType: target?.roomType ?? null, updatedAt: now },
    ),
  ]
  if (!target) {
    const last = rooms.reduce((highest, room) => Math.max(highest, room.sortOrder), 0)
    statements.push(newRoomRow(db, { projectId, roomName: targetName, roomType: null, sortOrder: last + 1, now }))
  }
  await runBatch(db, statements)
  return { ok: true }
}
