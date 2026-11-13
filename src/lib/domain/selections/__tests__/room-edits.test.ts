import Database from "better-sqlite3"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it } from "vitest"

import { drizzleOverSqlite } from "../../../../../__tests__/helpers/correspondence-core"
import { applyFinishScheduleImport } from "@/lib/domain/selections/finish-schedule-import"
import {
  addSelectionRoom,
  deleteSelectionRoom,
  duplicateSelection,
  duplicateSelectionRoom,
  moveSelectionToRoom,
  renameSelectionRoom,
  reorderSelectionRooms,
} from "@/lib/domain/selections/room-edits"
import { loadProjectSelections } from "@/lib/domain/selections/workspace"
import type { LoadedFinishSchedule } from "@/lib/domain/selections/rules"

/*
 * Room edits on a finish schedule (2026-11-13), against a database built
 * from every migration: rename, delete, reorder, add, duplicate, move, and a
 * workbook re-import that keeps what staff changed in Compass.
 */

type Sqlite = InstanceType<typeof Database>
const NOW = "2026-11-13T12:00:00.000Z"
let sqlite: Sqlite
let db: ReturnType<typeof drizzleOverSqlite>
let migratedImage: Buffer | null = null

function migrated(): Sqlite {
  if (!migratedImage) {
    const image = new Database(":memory:")
    const dir = join(process.cwd(), "drizzle")
    for (const file of readdirSync(dir).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort()) {
      image.exec(readFileSync(join(dir, file), "utf8").replaceAll("--> statement-breakpoint", ""))
    }
    migratedImage = image.serialize()
    image.close()
  }
  const copy = new Database(migratedImage)
  copy.exec("PRAGMA foreign_keys = ON")
  return copy
}

function rows<T>(query: string, ...values: unknown[]): T[] {
  return sqlite.prepare(query).all(...values) as T[]
}

beforeEach(() => {
  sqlite = migrated()
  sqlite.exec(`
    INSERT INTO organizations (id, name, slug, type, is_active, created_at, updated_at) VALUES ('org-1', 'Org', 'org', 'internal', 1, '${NOW}', '${NOW}');
    INSERT INTO projects (id, name, organization_id, project_number, created_at) VALUES ('p1', 'Job', 'org-1', 'O-1', '${NOW}');
    INSERT INTO project_finish_selection_rooms (id, project_id, source_system, room_name, room_type, sort_order, created_at, updated_at) VALUES
      ('r-kitchen', 'p1', 'compass', 'Kitchen', 'Kitchen', 1, '${NOW}', '${NOW}'),
      ('r-bath', 'p1', 'compass', 'Bath 1', 'Bathroom', 2, '${NOW}', '${NOW}');
    INSERT INTO project_finish_selections (id, project_id, room_name, room_type, name, category, quantity, manufacturer, status, owner_visible, created_at, updated_at) VALUES
      ('sink', 'p1', 'Bath 1', 'Bathroom', 'Sink', 'Plumbing', 1, 'Example Co', 'needed', 1, '${NOW}', '${NOW}'),
      ('faucet', 'p1', 'Bath 1', 'Bathroom', 'Faucet', 'Plumbing', 1, 'Example Co', 'needed', 1, '${NOW}', '${NOW}'),
      ('counter', 'p1', 'Kitchen', 'Kitchen', 'Countertop', 'Surfaces', 1, NULL, 'needed', 1, '${NOW}', '${NOW}');
    INSERT INTO project_selection_choices (id, project_id, selection_id, title, sort_order, chosen, status, source_system, created_at, updated_at) VALUES
      ('c-brushed', 'p1', 'faucet', 'Brushed nickel', 0, 1, 'proposed', 'compass', '${NOW}', '${NOW}'),
      ('c-black', 'p1', 'faucet', 'Matte black', 1, 0, 'proposed', 'compass', '${NOW}', '${NOW}');
  `)
  db = drizzleOverSqlite(sqlite)
})

async function roomOrder(): Promise<string[]> {
  return (await loadProjectSelections(db, "p1")).rooms.map((room) => room.roomName)
}

describe("rename a room", () => {
  it("moves the room row and every selection, and marks the room staff-edited", async () => {
    expect(await renameSelectionRoom(db, "p1", { fromName: "Bath 1", roomName: " Owner's  Bath ", roomType: "Primary bath" })).toEqual({ ok: true })
    expect(rows<{ room_name: string; room_type: string }>("SELECT room_name, room_type FROM project_finish_selections WHERE id IN ('sink', 'faucet')")).toEqual([
      { room_name: "Owner's Bath", room_type: "Primary bath" },
      { room_name: "Owner's Bath", room_type: "Primary bath" },
    ])
    const [room] = rows<{ room_name: string; staff_edited_at: string | null }>("SELECT room_name, staff_edited_at FROM project_finish_selection_rooms WHERE id = 'r-bath'")
    expect(room?.room_name).toBe("Owner's Bath")
    expect(room?.staff_edited_at).not.toBeNull()
  })

  it("refuses a name another room already has", async () => {
    const result = await renameSelectionRoom(db, "p1", { fromName: "Bath 1", roomName: "kitchen", roomType: null })
    expect(result.ok).toBe(false)
    expect(rows("SELECT id FROM project_finish_selections WHERE room_name = 'Bath 1'")).toHaveLength(2)
  })
})

describe("delete a room", () => {
  it("removes the room and its draft selections with their choices", async () => {
    expect(await deleteSelectionRoom(db, "p1", "Bath 1")).toEqual({ ok: true })
    expect(rows("SELECT id FROM project_finish_selections WHERE room_name = 'Bath 1'")).toHaveLength(0)
    expect(rows("SELECT id FROM project_selection_choices")).toHaveLength(0)
    expect(rows("SELECT id FROM project_finish_selection_rooms WHERE id = 'r-bath'")).toHaveLength(0)
    expect(await roomOrder()).toEqual(["Kitchen"])
  })

  it("refuses while a selection in it is approved, ordered or installed", async () => {
    sqlite.exec("UPDATE project_finish_selections SET status = 'ordered' WHERE id = 'sink'")
    const result = await deleteSelectionRoom(db, "p1", "Bath 1")
    expect(result.ok).toBe(false)
    expect(result.ok ? "" : result.error).toContain("Sink")
    expect(rows("SELECT id FROM project_finish_selections WHERE room_name = 'Bath 1'")).toHaveLength(2)
  })

  it("keeps a deleted workbook room as a deleted row, so a re-import leaves it out", async () => {
    sqlite.exec(`
      INSERT INTO project_finish_selection_rooms (id, project_id, source_system, source_workbook_id, source_sheet_id, source_sheet_name, room_name, sort_order, created_at, updated_at)
        VALUES ('r-sheet', 'p1', 'google_sheets', 'wb', '7', 'Laundry', 'Laundry', 3, '${NOW}', '${NOW}');
    `)
    expect(await deleteSelectionRoom(db, "p1", "Laundry")).toEqual({ ok: true })
    const [room] = rows<{ active: number; deleted_at: string | null }>("SELECT active, deleted_at FROM project_finish_selection_rooms WHERE id = 'r-sheet'")
    expect(room?.active).toBe(0)
    expect(room?.deleted_at).not.toBeNull()
  })
})

describe("room order", () => {
  it("saves the dragged order and refuses a stale list", async () => {
    expect(await roomOrder()).toEqual(["Kitchen", "Bath 1"])
    expect(await reorderSelectionRooms(db, "p1", ["Bath 1", "Kitchen"])).toEqual({ ok: true })
    expect(await roomOrder()).toEqual(["Bath 1", "Kitchen"])
    expect((await reorderSelectionRooms(db, "p1", ["Kitchen"])).ok).toBe(false)
  })

  it("adds an empty room at the end and refuses a duplicate name", async () => {
    expect(await addSelectionRoom(db, "p1", { roomName: "Mudroom", roomType: null })).toEqual({ ok: true })
    expect(await roomOrder()).toEqual(["Kitchen", "Bath 1", "Mudroom"])
    expect((await addSelectionRoom(db, "p1", { roomName: "MUDROOM", roomType: null })).ok).toBe(false)
  })
})

describe("duplicate", () => {
  it("copies a room's selections and choices as new, undecided selections", async () => {
    sqlite.exec(`
      UPDATE project_finish_selections SET status = 'approved', owner_approved = 1, approved_at = '${NOW}' WHERE id = 'faucet';
      INSERT INTO project_finish_selections (id, project_id, room_name, name, category, parent_selection_id, created_at, updated_at)
        VALUES ('drain', 'p1', 'Bath 1', 'Drain', 'Plumbing', 'faucet', '${NOW}', '${NOW}');
      INSERT INTO project_selection_choice_dependents (choice_id, selection_id, created_at) VALUES ('c-black', 'drain', '${NOW}');
    `)
    expect(await duplicateSelectionRoom(db, "p1", { fromName: "Bath 1", roomName: "Bath 2", roomType: "" })).toMatchObject({ ok: true, copied: 3 })
    const copies = rows<{ id: string; name: string; status: string; owner_approved: number; owner_visible: number; room_type: string; parent_selection_id: string | null }>(
      "SELECT id, name, status, owner_approved, owner_visible, room_type, parent_selection_id FROM project_finish_selections WHERE room_name = 'Bath 2' ORDER BY name",
    )
    expect(copies.map((copy) => [copy.name, copy.status, copy.owner_approved, copy.owner_visible, copy.room_type])).toEqual([
      ["Drain", "needed", 0, 0, "Bathroom"],
      ["Faucet", "needed", 0, 1, "Bathroom"],
      ["Sink", "needed", 0, 1, "Bathroom"],
    ])
    const faucetCopy = copies.find((copy) => copy.name === "Faucet")
    const drainCopy = copies.find((copy) => copy.name === "Drain")
    expect(drainCopy?.parent_selection_id).toBe(faucetCopy?.id)
    const choices = rows<{ id: string; title: string; chosen: number }>("SELECT id, title, chosen FROM project_selection_choices WHERE selection_id = ? ORDER BY sort_order", faucetCopy?.id)
    expect(choices.map((choice) => [choice.title, choice.chosen])).toEqual([["Brushed nickel", 0], ["Matte black", 0]])
    // The copied Matte black opens the copied Drain; the original links are untouched.
    const blackCopy = choices.find((choice) => choice.title === "Matte black")
    expect(rows("SELECT selection_id FROM project_selection_choice_dependents WHERE choice_id = ?", blackCopy?.id)).toEqual([{ selection_id: drainCopy?.id }])
    expect(rows("SELECT choice_id FROM project_selection_choice_dependents WHERE selection_id = 'drain'")).toEqual([{ choice_id: "c-black" }])
    expect(rows("SELECT choice_id FROM project_selection_choice_dependents WHERE selection_id = ?", drainCopy?.id)).toEqual([{ choice_id: blackCopy?.id }])
    // The original stays approved and picked.
    expect(rows("SELECT status FROM project_finish_selections WHERE id = 'faucet'")).toEqual([{ status: "approved" }])
    expect(await roomOrder()).toEqual(["Kitchen", "Bath 1", "Bath 2"])
  })

  it("never copies a replaced selection", async () => {
    sqlite.exec(`
      UPDATE project_finish_selections SET status = 'installed' WHERE id = 'sink';
      INSERT INTO project_finish_selections (id, project_id, room_name, name, category, replaces_selection_id, replacement_reason, created_at, updated_at)
        VALUES ('sink-2', 'p1', 'Bath 1', 'Sink', 'Plumbing', 'sink', 'installed_replaced', '${NOW}', '${NOW}');
    `)
    await duplicateSelectionRoom(db, "p1", { fromName: "Bath 1", roomName: "Bath 2", roomType: null })
    expect(rows("SELECT name FROM project_finish_selections WHERE room_name = 'Bath 2' ORDER BY name")).toEqual([{ name: "Faucet" }, { name: "Sink" }])
    expect((await duplicateSelection(db, "p1", "sink")).ok).toBe(false)
  })

  it("copies one selection in its room as \"(copy)\"", async () => {
    expect(await duplicateSelection(db, "p1", "faucet")).toEqual({ ok: true })
    expect(rows("SELECT room_name FROM project_finish_selections WHERE name = 'Faucet (copy)'")).toEqual([{ room_name: "Bath 1" }])
  })
})

describe("move a selection", () => {
  it("moves it with its follow-ups, making the room when it's new", async () => {
    sqlite.exec(`
      INSERT INTO project_finish_selections (id, project_id, room_name, name, category, created_at, updated_at) VALUES ('drain', 'p1', 'Bath 1', 'Drain', 'Plumbing', '${NOW}', '${NOW}');
      INSERT INTO project_selection_choice_dependents (choice_id, selection_id, created_at) VALUES ('c-black', 'drain', '${NOW}');
      UPDATE project_finish_selections SET status = 'ordered' WHERE id = 'faucet';
    `)
    expect(await moveSelectionToRoom(db, "p1", { selectionId: "faucet", roomName: "Powder Room" })).toEqual({ ok: true })
    expect(rows("SELECT id FROM project_finish_selections WHERE room_name = 'Powder Room' ORDER BY id")).toEqual([{ id: "drain" }, { id: "faucet" }])
    expect(await roomOrder()).toEqual(["Kitchen", "Bath 1", "Powder Room"])
  })
})

describe("workbook re-import", () => {
  const loaded = (roomName: string): LoadedFinishSchedule => ({
    workbookId: "wb",
    workbookTitle: "Finish schedule",
    parsed: {
      projectNumber: "O-1",
      warnings: [],
      rooms: [
        { sheetId: 7, sheetName: "Laundry", roomName, roomType: null, sortOrder: 1 },
        { sheetId: 8, sheetName: "Office", roomName: "Office", roomType: null, sortOrder: 2 },
      ],
      selections: [
        { sourceRowNumber: 2, sheetId: 7, sheetName: "Laundry", roomName, roomType: null, category: "Appliances", name: "Washer", description: null, quantity: 1, manufacturer: null, model: null, colorFinish: null, notes: null, sortOrder: 1 },
        { sourceRowNumber: 2, sheetId: 8, sheetName: "Office", roomName: "Office", roomType: null, category: "Lighting", name: "Desk lamp", description: null, quantity: 1, manufacturer: null, model: null, colorFinish: null, notes: null, sortOrder: 1 },
      ],
    },
  })

  it("keeps a Compass rename and leaves a deleted room out unless asked", async () => {
    await applyFinishScheduleImport(db, "p1", loaded("Laundry"))
    expect(await renameSelectionRoom(db, "p1", { fromName: "Laundry", roomName: "Laundry & Mud", roomType: null })).toEqual({ ok: true })
    expect(await deleteSelectionRoom(db, "p1", "Office")).toEqual({ ok: true })

    const counts = await applyFinishScheduleImport(db, "p1", loaded("Laundry"))
    expect(counts.skippedCount).toBe(1)
    expect(rows("SELECT room_name, name FROM project_finish_selections WHERE source_workbook_id = 'wb' ORDER BY name")).toEqual([{ room_name: "Laundry & Mud", name: "Washer" }])
    expect(await roomOrder()).not.toContain("Office")

    await applyFinishScheduleImport(db, "p1", loaded("Laundry"), { restoreDeletedRooms: true })
    expect(await roomOrder()).toContain("Office")
    expect(rows("SELECT name FROM project_finish_selections WHERE room_name = 'Office'")).toEqual([{ name: "Desk lamp" }])
  })
})
