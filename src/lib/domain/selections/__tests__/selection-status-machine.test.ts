import Database from "better-sqlite3"
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { migratedDatabase } from "@/test/migrated-database"

import { preloadSources, readSource, SOURCE_SCAN_TIMEOUT_MS, sourceFiles as sharedSourceFiles } from "@/test/source-tree"

import { eq } from "drizzle-orm"

import { drizzleOverSqlite } from "../../../../../__tests__/helpers/correspondence-core"

import { projectFinishSelections } from "@/db/schema"
import { advanceSelectionStatus } from "@/lib/domain/selections/status-advance"
import {
  automaticSelectionStatus,
  roundSignatureMachine,
  roundSignatureStatusAfter,
  selectionRequestMachine,
  selectionStatusAutomation,
} from "@/lib/domain/selections/status-machine"
import { PROJECT_SELECTION_STATUSES } from "@/lib/domain/selections/statuses"
import { setSelectionStatusByStaff, updateFinishSelections, updateFinishSelectionsWithEvent } from "@/lib/domain/selections/store"
import { availableEvents, machineProblems } from "@/lib/shared/state-machine"

/*
 * The selection status machine (Compass's own moves; staff stay free), the
 * round signature and owner request lifecycles, the store's compare-and-set
 * writes against a database built from every migration, and a guard that no
 * status write bypasses the store.
 */

describe("selection status automation", () => {
  it("is well formed over the shared status list", () => {
    expect(machineProblems(selectionStatusAutomation)).toEqual([])
    expect(selectionStatusAutomation.states).toEqual(PROJECT_SELECTION_STATUSES)
  })

  it("publishing moves only needed and proposed selections to With owner", () => {
    expect(automaticSelectionStatus("publish", "needed")).toBe("owner_review")
    expect(automaticSelectionStatus("publish", "proposed")).toBe("owner_review")
    for (const status of ["owner_review", "approved", "pricing", "rfq_sent", "ordered", "installed", "unavailable", "deferred"]) {
      expect(automaticSelectionStatus("publish", status)).toBeNull()
    }
  })

  it("an approval never rewinds procurement or installation", () => {
    expect(automaticSelectionStatus("owner_approve", "owner_review")).toBe("approved")
    expect(automaticSelectionStatus("owner_approve", "pricing")).toBeNull()
    expect(automaticSelectionStatus("owner_sign", "rfq_sent")).toBe("approved")
    expect(automaticSelectionStatus("owner_sign", "unavailable")).toBe("approved")
    for (const event of ["owner_approve", "owner_sign"] as const) {
      for (const status of ["approved", "ordered", "installed", "deferred"]) expect(automaticSelectionStatus(event, status)).toBeNull()
    }
  })

  it("a purchase order or daily log never moves a selection back, or out of deferred or unavailable", () => {
    expect(automaticSelectionStatus("order", "approved")).toBe("ordered")
    expect(automaticSelectionStatus("order", "rfq_sent")).toBe("ordered")
    expect(automaticSelectionStatus("install", "ordered")).toBe("installed")
    for (const status of ["ordered", "installed", "deferred", "unavailable"]) expect(automaticSelectionStatus("order", status)).toBeNull()
    for (const status of ["installed", "deferred", "unavailable"]) expect(automaticSelectionStatus("install", status)).toBeNull()
  })

  it("reopening sends any selection back to the owner, and old spellings are left alone", () => {
    for (const status of PROJECT_SELECTION_STATUSES) expect(automaticSelectionStatus("reopen", status)).toBe("owner_review")
    expect(automaticSelectionStatus("reopen", "selected")).toBeNull()
    expect(automaticSelectionStatus("order", "Approved")).toBeNull()
  })
})

describe("round signature and owner request lifecycles", () => {
  it("are well formed", () => {
    expect(machineProblems(roundSignatureMachine)).toEqual([])
    expect(machineProblems(selectionRequestMachine)).toEqual([])
  })

  it("signs only a prepared or sent signature, once", () => {
    expect(roundSignatureStatusAfter("sign", "sent")).toBe("signed")
    expect(roundSignatureStatusAfter("sign", "preparing")).toBe("signed")
    for (const status of ["signed", "declined", "cancelled"] as const) {
      expect(roundSignatureStatusAfter("sign", status)).toBeNull()
      expect(availableEvents(roundSignatureMachine, status)).toEqual([])
    }
    expect(roundSignatureStatusAfter("send", "sent")).toBeNull()
  })

  it("closes only an open request", () => {
    expect(availableEvents(selectionRequestMachine, "open")).toEqual(["resolve", "withdraw"])
    expect(availableEvents(selectionRequestMachine, "resolved")).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Store writes against a migrated database.
// ---------------------------------------------------------------------------

type Sqlite = InstanceType<typeof Database>
const NOW = "2026-11-12T12:00:00.000Z"
let sqlite: Sqlite
const actor = { id: "staff", email: "pm@example.com", displayName: "Pat PM", firstName: null, lastName: null, role: "project_manager" }

function migrated(): Sqlite {
  return migratedDatabase()
}

function statusOf(id: string): unknown {
  return sqlite.prepare("SELECT status FROM project_finish_selections WHERE id = ?").get(id)
}

describe("selection status writes", () => {
  beforeEach(() => {
    sqlite = migrated()
    sqlite.exec(`
      INSERT INTO organizations (id, name, slug, type, is_active, created_at, updated_at) VALUES ('org-1', 'Org', 'org', 'internal', 1, '${NOW}', '${NOW}');
      INSERT INTO projects (id, name, organization_id, created_at) VALUES ('p1', 'Job', 'org-1', '${NOW}');
      INSERT INTO project_finish_selections (id, project_id, room_name, name, status, created_at, updated_at) VALUES
        ('tile', 'p1', 'Kitchen', 'Backsplash', 'approved', '${NOW}', '${NOW}'),
        ('legacy', 'p1', 'Kitchen', 'Old row', 'selected', '${NOW}', '${NOW}');
    `)
  })
  afterEach(() => sqlite.close())

  it("a staff change lands only on the status the person saw", async () => {
    const db = drizzleOverSqlite(sqlite)
    expect(await setSelectionStatusByStaff(db, { projectId: "p1", selectionId: "tile", expected: "owner_review", status: "deferred" })).toBe(false)
    expect(statusOf("tile")).toEqual({ status: "approved" })
    expect(await setSelectionStatusByStaff(db, { projectId: "p1", selectionId: "tile", expected: "approved", status: "deferred" })).toBe(true)
    expect(statusOf("tile")).toEqual({ status: "deferred" })
    // A stored value off the list is still matched as text.
    expect(await setSelectionStatusByStaff(db, { projectId: "p1", selectionId: "legacy", expected: "selected", status: "needed" })).toBe(true)
  })

  it("an automatic move skipped by a concurrent staff change is not logged", async () => {
    const db = drizzleOverSqlite(sqlite)
    // Staff deferred the selection between the PO's read and its write: simulated by a trigger.
    sqlite.exec(`
      CREATE TRIGGER defer_first BEFORE UPDATE OF status ON project_finish_selections
      WHEN OLD.id = 'tile' AND NEW.status = 'ordered'
      BEGIN SELECT RAISE(IGNORE); END;
    `)
    expect(await advanceSelectionStatus(db, { projectId: "p1", selectionIds: ["tile"], target: "ordered", reason: { kind: "published" }, actor })).toEqual([])
    expect(sqlite.prepare("SELECT count(*) AS n FROM activity_events").get()).toEqual({ n: 0 })
  })

  it("an event write records its columns everywhere but moves only its source states", async () => {
    const db = drizzleOverSqlite(sqlite)
    sqlite.exec(`UPDATE project_finish_selections SET status = 'ordered' WHERE id = 'tile'`)
    await updateFinishSelectionsWithEvent(db, eq(projectFinishSelections.projectId, "p1"), "owner_sign", { ownerApproved: true, approvedAt: NOW })
    expect(sqlite.prepare("SELECT id, status, owner_approved FROM project_finish_selections ORDER BY id").all()).toEqual([
      { id: "legacy", status: "selected", owner_approved: 1 },
      { id: "tile", status: "ordered", owner_approved: 1 },
    ])
  })

  it("plain updates refuse a status", async () => {
    const db = drizzleOverSqlite(sqlite)
    // A spread from an untyped source can carry status past the type.
    const patch = { notes: "x" }
    Reflect.set(patch, "status", "installed")
    await expect(updateFinishSelections(db, eq(projectFinishSelections.id, "tile"), patch)).rejects.toThrow(/status functions/)
  })
})

// ---------------------------------------------------------------------------
// Guard: selection and round signature status writes go through their stores.
// ---------------------------------------------------------------------------

const SOURCE_OPTIONS = { skipDirectories: ["__tests__"], include: /\.(ts|tsx)$/ }

function sourceFiles(dir: string): readonly string[] {
  return sharedSourceFiles(dir, SOURCE_OPTIONS)
}

// Read the tree once for this file, as setup (see @/test/source-tree).
beforeAll(() => preloadSources("src", SOURCE_OPTIONS), SOURCE_SCAN_TIMEOUT_MS)

// Read once: the whole tree is scanned by several checks, under full-suite load.
let sources: ReadonlyMap<string, string> | null = null
function sourceTree(): ReadonlyMap<string, string> {
  sources ??= new Map(sourceFiles("src").map((file) => [file, readSource(file)]))
  return sources
}

describe("selection status write guard", { timeout: 30_000 }, () => {
  it("only the selections store updates project_finish_selections", () => {
    const writers = [...sourceTree()].filter(([, source]) =>
      /\.update\((schema\.)?projectFinishSelections\)|UPDATE\s+project_finish_selections/i.test(source),
    ).map(([file]) => file)
    expect(writers).toEqual(["src/lib/domain/selections/store.ts"])
  })

  it("only the round signature store updates round signatures", () => {
    const writers = [...sourceTree()].filter(([, source]) =>
      /\.update\((schema\.)?projectSelectionRoundSignatures\)|UPDATE\s+project_selection_round_signatures/i.test(source),
    ).map(([file]) => file)
    expect(writers).toEqual(["src/lib/domain/selections/round-signature-store.ts"])
  })

  it("no caller writes a selection status as a raw CASE or literal outside the store", () => {
    const offenders = [...sourceTree()].filter(([file, source]) => {
      if (file === "src/lib/domain/selections/store.ts") return false
      return /updateFinishSelections(Statement)?\([^)]*\bstatus:/s.test(source) || /THEN 'approved' ELSE/.test(source)
    }).map(([file]) => file)
    expect(offenders).toEqual([])
  })

  it("the store's status writes are compare-and-set and read the machine", () => {
    const store = readSource("src/lib/domain/selections/store.ts")
    const staff = store.slice(store.indexOf("export async function setSelectionStatusByStaff"))
    expect(staff.slice(0, staff.indexOf("\n}\n"))).toContain("sql`${projectFinishSelections.status} = ${input.expected}`")
    const automatic = store.slice(store.indexOf("export function automaticSelectionStatusStatement"))
    const body = automatic.slice(0, automatic.indexOf("\n}\n"))
    expect(body).toContain("automaticSelectionStatus(move.event, move.stored)")
    expect(body).toContain("sql`${projectFinishSelections.status} = ${move.stored}`")
    expect(store).toContain("inArray(projectFinishSelections.status, [...selectionStatusSources(event)])")
  })
})
