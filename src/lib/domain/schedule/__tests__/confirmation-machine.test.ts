import { afterEach, beforeAll, describe, expect, it } from "vitest"

import { migratedDb } from "@/lib/domain/__tests__/sqlite-d1"
import { insertRow } from "@/test/migrated-database"
import { preloadSources, readSource, SOURCE_SCAN_TIMEOUT_MS, sourceFiles as sharedSourceFiles } from "@/test/source-tree"
import { confirmationMachine, staffConfirmationEvent } from "@/lib/domain/schedule/confirmation-machine"
import { SCHEDULE_CONFIRMATION_STATUSES } from "@/lib/domain/schedule/statuses"
import { d1, migratedSqlite } from "@/lib/daily-logs/__tests__/sqlite-d1"
import { MAX_DATE_MOVE_STATEMENTS, dateMoveStatementCount, dateMovesLimitError } from "@/lib/domain/schedule/date-moves"
import {
  acceptConfirmationProposal,
  persistScheduleDateUpdates,
  recordConfirmationAnswer,
  runWithDateUpdates,
  rejectConfirmationProposal,
  restoreConfirmationProposal,
} from "@/lib/domain/schedule/store"
import { newScheduleConfirmationState } from "@/lib/schedule/confirmation"
import { availableEvents, machineProblems, nextState } from "@/lib/shared/state-machine"

describe("schedule confirmation machine", () => {
  it("is well formed", () => {
    expect(machineProblems(confirmationMachine)).toEqual([])
  })

  it("lets staff restart from any state and the assignee answer once asked", () => {
    for (const from of SCHEDULE_CONFIRMATION_STATUSES) {
      for (const event of ["request", "await_account", "stop"] as const) {
        expect(nextState(confirmationMachine, from, event).ok).toBe(true)
      }
    }
    expect(availableEvents(confirmationMachine, "not_requested")).toEqual(["request", "await_account", "stop"])
    expect(nextState(confirmationMachine, "confirmed", "decline").ok).toBe(true)
    expect(nextState(confirmationMachine, "confirmed", "reject_proposal").ok).toBe(false)
    expect(nextState(confirmationMachine, "confirmed", "accept_proposal").ok).toBe(false)
    expect(nextState(confirmationMachine, "proposed", "accept_proposal")).toEqual({ ok: true, from: "proposed", to: "pending" })
  })

  it("re-asks on moved dates only once the assigned account was asked", () => {
    const reasked = SCHEDULE_CONFIRMATION_STATUSES.filter((from) => nextState(confirmationMachine, from, "dates_moved").ok)
    expect(reasked).toEqual(["pending", "confirmed", "declined", "proposed"])
    expect(confirmationMachine.transitions.dates_moved.to).toBe("pending")
  })

  it("starts what staff's settings ask for, as before", () => {
    expect(staffConfirmationEvent({ required: false, assignedUserId: "u1" })).toBe("stop")
    expect(newScheduleConfirmationState({ required: true, assignedUserId: "u1", now: "t" })).toEqual({ status: "pending", requestedAt: "t" })
    expect(newScheduleConfirmationState({ required: true, assignedUserId: null, now: "t" })).toEqual({ status: "unavailable", requestedAt: "t" })
    expect(newScheduleConfirmationState({ required: false, assignedUserId: null, now: "t" })).toEqual({ status: "not_requested", requestedAt: null })
  })

  // Production values (read only, 2026-11-12): not_requested 5969,
  // unavailable 98, pending 6, confirmed 1.
  it("lists every status stored in production", () => {
    const production = ["not_requested", "unavailable", "pending", "confirmed"]
    expect(production.filter((value) => !includes(SCHEDULE_CONFIRMATION_STATUSES, value))).toEqual([])
  })
})

function includes(list: readonly string[], value: string): boolean {
  return list.includes(value)
}

let current: ReturnType<typeof migratedDb> | null = null
afterEach(() => {
  current?.sqlite.close()
  current = null
})

// Production's schedule_tasks (every migration), with the parents its keys need.
function seed(status = "pending"): ReturnType<typeof migratedDb> {
  current = migratedDb()
  insertRow(current.sqlite, "organizations", { id: "org", type: "internal" })
  insertRow(current.sqlite, "users", { id: "u1", role: "subcontractor" })
  insertRow(current.sqlite, "users", { id: "u2", role: "subcontractor" })
  insertRow(current.sqlite, "projects", { id: "p1", organization_id: "org" })
  insertRow(current.sqlite, "schedule_tasks", {
    id: "t1", project_id: "p1", title: "Framing", phase: "framing", assigned_user_id: "u1", start_date: "2026-09-14",
    workdays: 3, end_date_calculated: "2026-09-16", confirmation_required: 1, confirmation_status: status,
    confirmation_requested_at: "r0", created_at: "t0", updated_at: "t0",
  })
  return current
}

const SEEN = { id: "t1", assignedUserId: "u1", startDate: "2026-09-14", workdays: 3, confirmationRequestedAt: "r0", confirmationRespondedAt: null }
const NOTE = { proposedStartDate: null, proposedWorkdays: null, proposalNote: null, proposalSubmittedAt: null }

function row(sqlite: ReturnType<typeof migratedDb>["sqlite"]): unknown {
  return sqlite.prepare("SELECT confirmation_status, confirmation_responded_at FROM schedule_tasks WHERE id = 't1'").get()
}

describe("recordConfirmationAnswer", () => {
  it("records an answer to the current request and dates", async () => {
    const { sqlite, db } = seed()
    expect(await recordConfirmationAnswer(db, SEEN, "confirm", { ...NOTE, respondedAt: "t1" })).toBe("recorded")
    expect(row(sqlite)).toEqual({ confirmation_status: "confirmed", confirmation_responded_at: "t1" })
  })

  it("lands a double submit once, and a different stale answer not at all", async () => {
    const { sqlite, db } = seed()
    await recordConfirmationAnswer(db, SEEN, "confirm", { ...NOTE, respondedAt: "t1" })
    expect(await recordConfirmationAnswer(db, SEEN, "confirm", { ...NOTE, respondedAt: "t2" })).toBe("already_recorded")
    expect(await recordConfirmationAnswer(db, SEEN, "decline", { ...NOTE, respondedAt: "t2" })).toBe("schedule_changed")
    expect(row(sqlite)).toEqual({ confirmation_status: "confirmed", confirmation_responded_at: "t1" })
  })

  it("does not land on moved dates, a new request or another assignee", async () => {
    for (const change of ["start_date = '2026-09-21'", "confirmation_requested_at = 'r1'", "assigned_user_id = 'u2'", "confirmation_required = 0"]) {
      const { sqlite, db } = seed()
      sqlite.exec(`UPDATE schedule_tasks SET ${change}`)
      expect(await recordConfirmationAnswer(db, SEEN, "confirm", { ...NOTE, respondedAt: "t1" })).toBe("schedule_changed")
      sqlite.close()
      current = null
    }
  })

  it("needs a request: an item that asks for nothing takes no answer", async () => {
    const { db } = seed("not_requested")
    expect(await recordConfirmationAnswer(db, SEEN, "confirm", { ...NOTE, respondedAt: "t1" })).toBe("schedule_changed")
  })
})

describe("rejectConfirmationProposal", () => {
  it("asks again only while a proposal waits", async () => {
    const { sqlite, db } = seed("proposed")
    expect(await rejectConfirmationProposal(db, "t1", "t2")).toBe(true)
    expect(row(sqlite)).toEqual({ confirmation_status: "pending", confirmation_responded_at: null })
    // The assignee confirmed after staff opened the proposal: their answer stays.
    sqlite.exec("UPDATE schedule_tasks SET confirmation_status = 'confirmed'")
    expect(await rejectConfirmationProposal(db, "t1", "t3")).toBe(false)
  })
})

describe("acceptConfirmationProposal", () => {
  function proposed(): ReturnType<typeof migratedDb> {
    const seeded = seed("proposed")
    seeded.sqlite.exec(`UPDATE schedule_tasks SET confirmation_responded_at = 's1', proposal_submitted_at = 's1',
      proposed_start_date = '2026-09-21', proposed_workdays = 4`)
    return seeded
  }
  const state = (sqlite: ReturnType<typeof migratedDb>["sqlite"]): unknown =>
    sqlite.prepare("SELECT confirmation_status, confirmation_requested_at, proposal_submitted_at, proposed_start_date FROM schedule_tasks").get()

  it("takes the proposal staff reviewed and asks the assignee to confirm it", async () => {
    const { sqlite, db } = proposed()
    expect(await acceptConfirmationProposal(db, "t1", "s1", "accept_proposal", "t2")).toBe(true)
    expect(state(sqlite)).toEqual({ confirmation_status: "pending", confirmation_requested_at: "t2", proposal_submitted_at: null, proposed_start_date: null })
  })

  it("stops when the assignee answered after staff opened the proposal", async () => {
    for (const answer of [
      "confirmation_status = 'confirmed', proposal_submitted_at = NULL, confirmation_responded_at = 's2'",
      "proposal_submitted_at = 's2', confirmation_responded_at = 's2'",
    ]) {
      const { sqlite, db } = proposed()
      sqlite.exec(`UPDATE schedule_tasks SET ${answer}`)
      const before = state(sqlite)
      expect(await acceptConfirmationProposal(db, "t1", "s1", "accept_proposal", "t2")).toBe(false)
      expect(state(sqlite)).toEqual(before)
      sqlite.close()
      current = null
    }
  })

  it("stops asking when staff turned the answer off in the same save", async () => {
    const { sqlite, db } = proposed()
    expect(await acceptConfirmationProposal(db, "t1", "s1", "stop", "t2")).toBe(true)
    expect(state(sqlite)).toMatchObject({ confirmation_status: "not_requested", confirmation_requested_at: null })
  })
})

describe("restoreConfirmationProposal", () => {
  const BEFORE = {
    id: "t1", assignedUserId: "u1", confirmationRequestedAt: "r0", confirmationRespondedAt: "s1", reminderSentAt: null,
    proposedStartDate: "2026-09-21", proposedWorkdays: 4, proposalNote: "Crew free then", proposalSubmittedAt: "s1",
  }
  const state = (sqlite: ReturnType<typeof migratedDb>["sqlite"]): unknown =>
    sqlite.prepare("SELECT confirmation_status, confirmation_responded_at, proposal_submitted_at, proposed_start_date, updated_at FROM schedule_tasks").get()

  it("puts back the proposal a failed save took", async () => {
    const { sqlite, db } = seed("proposed")
    sqlite.exec("UPDATE schedule_tasks SET confirmation_responded_at = 's1', proposal_submitted_at = 's1', proposed_start_date = '2026-09-21', proposed_workdays = 4")
    expect(await acceptConfirmationProposal(db, "t1", "s1", "accept_proposal", "t2")).toBe(true)
    expect(await restoreConfirmationProposal(db, BEFORE, "t2")).toBe(true)
    expect(state(sqlite)).toEqual({ confirmation_status: "proposed", confirmation_responded_at: "s1", proposal_submitted_at: "s1", proposed_start_date: "2026-09-21", updated_at: "t2" })
  })

  it("leaves the item alone once something else changed it", async () => {
    for (const change of ["updated_at = 't3'", "confirmation_status = 'confirmed', confirmation_responded_at = 's2'", "assigned_user_id = 'u2'"]) {
      const { sqlite, db } = seed("pending")
      sqlite.exec(`UPDATE schedule_tasks SET updated_at = 't2', ${change}`)
      expect(await restoreConfirmationProposal(db, BEFORE, "t2")).toBe(false)
      sqlite.close()
      current = null
    }
  })
})

describe("date moves ask again", () => {
  const NOW = "2026-11-12T20:00:00.000Z"
  const MOVED = { startDate: "2026-09-21", endDateCalculated: "2026-09-23" }
  const SAME = { startDate: "2026-09-14", endDateCalculated: "2026-09-16" }
  const REASK = { reaskOnDateMove: true }

  function scheduled(rows: readonly (readonly [string, string, number, string | null])[]) {
    const sqlite = migratedSqlite()
    sqlite.exec(`
      INSERT INTO organizations (id, name, slug, type, is_active, created_at, updated_at) VALUES ('org-1', 'Example Co', 'example', 'internal', 1, '${NOW}', '${NOW}');
      INSERT INTO users (id, email, display_name, role, is_active, created_at, updated_at) VALUES ('u1', 'sub@example.com', 'Sub', 'subcontractor', 1, '${NOW}', '${NOW}');
      INSERT INTO projects (id, name, organization_id, status, created_at) VALUES ('p1', 'Bishop Residence', 'org-1', 'active', '${NOW}');
    `)
    for (const [id, status, required, user] of rows) {
      sqlite.prepare(`INSERT INTO schedule_tasks (id, project_id, title, start_date, workdays, end_date_calculated, phase,
          assigned_user_id, confirmation_required, confirmation_status, confirmation_requested_at, confirmation_responded_at,
          proposed_start_date, proposed_workdays, proposal_submitted_at, created_at, updated_at)
        VALUES (?, 'p1', ?, '2026-09-14', 3, '2026-09-16', 'framing', ?, ?, ?, 'r0', 's0', '2026-09-21', 4, 's0', '${NOW}', '${NOW}')`)
        .run(id, id, user, required, status)
    }
    const database = d1(sqlite) as unknown as D1Database
    const confirmations = () => sqlite.prepare(`SELECT id, start_date, workdays, confirmation_status, confirmation_requested_at,
      confirmation_responded_at, proposal_submitted_at FROM schedule_tasks ORDER BY rowid`).all()
    return { sqlite, database, confirmations }
  }
  const reasked = (id: string, start = "2026-09-21", workdays = 3) => ({ id, start_date: start, workdays, confirmation_status: "pending", confirmation_requested_at: "t2", confirmation_responded_at: null, proposal_submitted_at: null })
  const kept = (id: string, status: string, start = "2026-09-21") => ({ id, start_date: start, workdays: 3, confirmation_status: status, confirmation_requested_at: "r0", confirmation_responded_at: "s0", proposal_submitted_at: "s0" })

  it("asks a single assignee again once dates move, unless nothing was asked of an account or nothing moved", async () => {
    const rows = [
      ["confirmed", "confirmed", 1, "u1"],
      ["declined", "declined", 1, "u1"],
      ["proposed", "proposed", 1, "u1"],
      ["pending", "pending", 1, "u1"],
      ["unavailable", "unavailable", 1, null],
      ["not_requested", "not_requested", 0, "u1"],
      ["not_required", "confirmed", 0, "u1"],
      ["unmoved", "confirmed", 1, "u1"],
    ] as const
    const { database, confirmations } = scheduled(rows)
    const moves = new Map(rows.map(([id]) => [id, id === "unmoved" ? SAME : MOVED]))
    await persistScheduleDateUpdates(database, "p1", moves, "t2", REASK)

    expect(confirmations()).toEqual([
      reasked("confirmed"),
      reasked("declined"),
      reasked("proposed"),
      reasked("pending"),
      kept("unavailable", "unavailable"),
      kept("not_requested", "not_requested"),
      kept("not_required", "confirmed"),
      kept("unmoved", "confirmed", "2026-09-14"),
    ])
  })

  it("counts a duration change as a move and writes the workdays with it", async () => {
    const { database, confirmations } = scheduled([["longer", "confirmed", 1, "u1"], ["same", "confirmed", 1, "u1"]])
    await persistScheduleDateUpdates(database, "p1", new Map([
      ["longer", { startDate: "2026-09-14", endDateCalculated: "2026-09-17", workdays: 4 }],
      ["same", { ...SAME, workdays: 3 }],
    ]), "t2", REASK)
    expect(confirmations()).toEqual([reasked("longer", "2026-09-14", 4), kept("same", "confirmed", "2026-09-14")])
  })

  it("resets multi-assignee responses only on items that moved", async () => {
    const { sqlite, database } = scheduled([["moved", "not_requested", 0, null], ["unmoved", "not_requested", 0, null]])
    sqlite.exec("PRAGMA foreign_keys = OFF")
    for (const task of ["moved", "unmoved"]) {
      sqlite.prepare(`INSERT INTO schedule_task_assignees (id, schedule_task_id, participant_id, source_start_date, source_workdays,
          source_end_date, response_status, date_response_status, duration_response_status, responded_at, assigned_at, created_at, updated_at)
        VALUES (?, ?, 'person-1', '2026-09-14', 3, '2026-09-16', 'confirmed', 'confirmed', 'confirmed', 's0', 'a0', '${NOW}', '${NOW}')`)
        .run(`a-${task}`, task)
    }
    await persistScheduleDateUpdates(database, "p1", new Map([["moved", MOVED], ["unmoved", SAME]]), "t2", REASK)
    expect(sqlite.prepare("SELECT schedule_task_id, source_start_date, response_status, responded_at, assigned_at FROM schedule_task_assignees ORDER BY rowid").all()).toEqual([
      { schedule_task_id: "moved", source_start_date: "2026-09-21", response_status: "pending", responded_at: null, assigned_at: "t2" },
      { schedule_task_id: "unmoved", source_start_date: "2026-09-14", response_status: "confirmed", responded_at: "s0", assigned_at: "a0" },
    ])
  })

  it("asks again when a dependency or calendar change moves the dates", async () => {
    const { database, confirmations } = scheduled([["confirmed", "confirmed", 1, "u1"]])
    const leading = database.prepare("UPDATE projects SET name = name WHERE id = 'p1'")
    await runWithDateUpdates(database, leading, "p1", new Map([["confirmed", MOVED]]), "t2", "failed", REASK)
    expect(confirmations()).toEqual([reasked("confirmed")])
  })

  it("moves a 450-item cascade with no linked to-dos in a few statements, well under D1's cap", async () => {
    const ids = Array.from({ length: 450 }, (_, index) => `t${index}`)
    const { sqlite, database } = scheduled(ids.map((id) => [id, "confirmed", 1, "u1"] as const))
    const sizes: number[] = []
    const counting = { ...database, batch: (statements: D1PreparedStatement[]) => { sizes.push(statements.length); return database.batch(statements) } } as unknown as D1Database
    const moves = new Map(ids.map((id) => [id, MOVED]))
    expect(dateMovesLimitError(moves, 1)).toBeNull()
    expect(dateMoveStatementCount(moves, 1)).toBe(16)
    const leading = database.prepare("UPDATE projects SET name = name WHERE id = 'p1'")
    await runWithDateUpdates(counting, leading, "p1", moves, "t2", "failed", REASK)
    // Groups of 100: linked to-dos, dates with the single re-ask, multi re-ask; the leading change rides with the first.
    expect(sizes).toEqual([4, 3, 3, 3, 3])
    expect(sizes.reduce((total, size) => total + size, 0)).toBeLessThan(MAX_DATE_MOVE_STATEMENTS)
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM schedule_tasks WHERE confirmation_status = 'pending' AND start_date = '2026-09-21' AND end_date_calculated = '2026-09-23'").get()).toEqual({ n: 450 })
  })

  it("refuses a request over the statement cap before writing anything", async () => {
    const { database } = scheduled([["t0", "confirmed", 1, "u1"]])
    const sizes: number[] = []
    const counting = { ...database, batch: (statements: D1PreparedStatement[]) => { sizes.push(statements.length); return database.batch(statements) } } as unknown as D1Database
    const pathological = new Map(Array.from({ length: 30_001 }, (_, index) => [`x${index}`, MOVED]))
    expect(dateMovesLimitError(pathological)).toMatch(/more than Compass can save at once \(903 of 900 database writes\)/)
    await expect(persistScheduleDateUpdates(counting, "p1", pathological, "t4", REASK)).rejects.toThrow(/smaller steps/)
    const leading = database.prepare("UPDATE projects SET name = 'changed' WHERE id = 'p1'")
    await expect(runWithDateUpdates(counting, leading, "p1", pathological, "t4", "failed", REASK)).rejects.toThrow(/smaller steps/)
    expect(sizes).toEqual([])
  })

  it("keeps answers on moved dates when the company turned asking again off", async () => {
    const { sqlite, database, confirmations } = scheduled([["confirmed", "confirmed", 1, "u1"]])
    sqlite.exec("PRAGMA foreign_keys = OFF")
    sqlite.exec(`INSERT INTO schedule_task_assignees (id, schedule_task_id, participant_id, source_start_date, source_workdays,
        source_end_date, response_status, date_response_status, duration_response_status, responded_at, assigned_at, created_at, updated_at)
      VALUES ('a1', 'confirmed', 'person-1', '2026-09-14', 3, '2026-09-16', 'confirmed', 'confirmed', 'confirmed', 's0', 'a0', '${NOW}', '${NOW}')`)
    await persistScheduleDateUpdates(database, "p1", new Map([["confirmed", MOVED]]), "t2", { reaskOnDateMove: false })
    expect(confirmations()).toEqual([kept("confirmed", "confirmed")])
    expect(sqlite.prepare("SELECT response_status FROM schedule_task_assignees").get()).toEqual({ response_status: "confirmed" })
  })
})

describe("schedule date writes", () => {
  const EXEMPT = new Set([
    // One-off Buildertrend import refresh, run by hand against freshly
    // imported items before anyone was asked to confirm them.
    "scripts/lib/buildertrend-schedule-refresh.mjs",
    // One-off O-58-3674 operational cutover; done and never re-run.
    "scripts/lib/o-58-3674-operational-cutover.mjs",
    // Local end-to-end fixtures (seeded into a local database only).
    "scripts/seed-e2e-local.mjs",
  ])
  const STORE = "src/lib/domain/schedule/store.ts"

  // Read src/ and scripts/ once, as setup (see @/test/source-tree).
  beforeAll(() => {
    preloadSources("src", SOURCE_OPTIONS)
    preloadSources("scripts", SCRIPT_OPTIONS)
  }, SOURCE_SCAN_TIMEOUT_MS)

  it("go through the store's date moves only, anywhere in src/ or scripts/", () => {
    const storeText = readSource(STORE)
    const helperStart = storeText.indexOf("function dateWriteStatement(")
    const helper = storeText.slice(helperStart, storeText.indexOf("\n}\n", helperStart))
    const code = [...sourceFiles("src"), ...scriptFiles("scripts")]
      .filter((path) => !EXEMPT.has(path))
      .map((path) => ({ path, text: path === STORE ? storeText.replace(helper, "") : readSource(path) }))
    expect(helper).toContain("start_date = ${next(\"start\")}, end_date_calculated = ${next(\"end\")}")
    // Raw SQL setting start_date, workdays or end_date_calculated (not proposed_/source_ columns).
    const dateColumn = String.raw`(?<![\w.])(start_date|workdays|end_date_calculated)\s*=`
    const raw = [
      new RegExp(String.raw`UPDATE\s+schedule_tasks\b[\s\S]{0,800}?\bSET\b[\s\S]{0,800}?` + dateColumn, "i"),
      // An upsert that rewrites an existing item's dates, or replaces the row outright.
      new RegExp(String.raw`INSERT\s+(?:OR\s+\w+\s+)?INTO\s+schedule_tasks\b[\s\S]{0,3000}?ON\s+CONFLICT\b[\s\S]{0,400}?DO\s+UPDATE\s+SET\b[\s\S]{0,800}?` + dateColumn, "i"),
      /(?:INSERT\s+OR\s+REPLACE|\bREPLACE)\s+INTO\s+schedule_tasks\b/i,
    ]
    expect(code.filter(({ text }) => raw.some((pattern) => pattern.test(text))).map(({ path }) => path)).toEqual([])
    // Drizzle upserts that rewrite an item's dates.
    const upsert = /\.insert\(scheduleTasks\)[\s\S]{0,1500}?onConflictDoUpdate\(\{[\s\S]{0,600}?\b(startDate|workdays|endDateCalculated)\b/
    expect(code.filter(({ text }) => upsert.test(text)).map(({ path }) => path)).toEqual([])
    // Drizzle updates of schedule_tasks that set a date column.
    const drizzle = code.flatMap(({ path, text }) =>
      text.split(/\.update\(scheduleTasks\)/).slice(1)
        .filter((update) => /\b(startDate|workdays|endDateCalculated)\b/.test(update.slice(0, update.indexOf(".where("))))
        .map(() => path)
    )
    expect(drizzle).toEqual([])
    // The store's generic task update can't carry them either.
    expect(storeText).toContain('type TaskUpdate = Omit<Partial<TaskInsert>, "startDate" | "workdays" | "endDateCalculated">')
  }, 30_000)
})

const SCRIPT_OPTIONS = { skipDirectories: ["node_modules"], include: /^(?!.*\.test\.(mjs|ts|js)$).*\.(mjs|ts|js)$/ }
const SOURCE_OPTIONS = { skipDirectories: ["__tests__"], include: /^(?!.*\.test\.tsx?$).*\.(ts|tsx)$/ }

function scriptFiles(dir: string): readonly string[] {
  return sharedSourceFiles(dir, SCRIPT_OPTIONS)
}

function sourceFiles(dir: string): readonly string[] {
  return sharedSourceFiles(dir, SOURCE_OPTIONS)
}

describe("confirmation status writes", () => {
  // Read the tree once for this file, as setup (see @/test/source-tree).
  beforeAll(() => preloadSources("src", SOURCE_OPTIONS), SOURCE_SCAN_TIMEOUT_MS)

  it("only schedule/store.ts writes schedule_tasks", () => {
    const files = sourceFiles("src").map((path) => ({ path, text: readSource(path) }))
    const writers = files.filter(({ text }) => /\.(update|insert)\(scheduleTasks\)|(UPDATE|INSERT INTO)\s+schedule_tasks/i.test(text))
    expect(writers.map(({ path }) => path)).toEqual(["src/lib/domain/schedule/store.ts"])
  })

  it("never come from a literal status", () => {
    // Files that build schedule_tasks writes. Read-side views (the audience
    // preview's fallback item) are not writes.
    const writers = [
      "src/lib/domain/schedule/store.ts",
      "src/lib/domain/schedule/rules.ts",
      "src/lib/schedule/confirmation.ts",
      "src/app/actions/schedule.ts",
      "src/app/actions/schedule-confirmations.ts",
      "src/app/api/compass/schedule/route.ts",
    ]
    const literal = /confirmationStatus:\s*["'`]|confirmation_status\s*=\s*'|'(not_requested|unavailable)'/
    expect(writers.filter((path) => literal.test(readSource(path)))).toEqual([])
  })
})
