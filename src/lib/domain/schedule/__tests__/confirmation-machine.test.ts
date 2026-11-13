import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { sqliteDb } from "@/lib/domain/__tests__/sqlite-d1"
import { confirmationMachine, staffConfirmationEvent } from "@/lib/domain/schedule/confirmation-machine"
import { SCHEDULE_CONFIRMATION_STATUSES } from "@/lib/domain/schedule/statuses"
import { d1, migratedSqlite } from "@/lib/daily-logs/__tests__/sqlite-d1"
import {
  acceptConfirmationProposal,
  persistScheduleDateUpdates,
  recordConfirmationAnswer,
  runWithDateUpdates,
  rejectConfirmationProposal,
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

let current: ReturnType<typeof sqliteDb> | null = null
afterEach(() => {
  current?.sqlite.close()
  current = null
})

function seed(status = "pending"): ReturnType<typeof sqliteDb> {
  current = sqliteDb(`CREATE TABLE schedule_tasks (id text PRIMARY KEY, assigned_user_id text, start_date text NOT NULL,
    workdays integer NOT NULL, confirmation_required integer NOT NULL, confirmation_status text NOT NULL,
    confirmation_requested_at text, confirmation_responded_at text, proposed_start_date text, proposed_workdays integer,
    proposal_note text, proposal_submitted_at text, reminder_sent_at text, updated_at text NOT NULL)`)
  current.sqlite.prepare(`INSERT INTO schedule_tasks VALUES ('t1', 'u1', '2026-09-14', 3, 1, ?, 'r0', NULL, NULL, NULL, NULL, NULL, NULL, 't0')`).run(status)
  return current
}

const SEEN = { id: "t1", assignedUserId: "u1", startDate: "2026-09-14", workdays: 3, confirmationRequestedAt: "r0", confirmationRespondedAt: null }
const NOTE = { proposedStartDate: null, proposedWorkdays: null, proposalNote: null, proposalSubmittedAt: null }

function row(sqlite: ReturnType<typeof sqliteDb>["sqlite"]): unknown {
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
  function proposed(): ReturnType<typeof sqliteDb> {
    const seeded = seed("proposed")
    seeded.sqlite.exec(`UPDATE schedule_tasks SET confirmation_responded_at = 's1', proposal_submitted_at = 's1',
      proposed_start_date = '2026-09-21', proposed_workdays = 4`)
    return seeded
  }
  const state = (sqlite: ReturnType<typeof sqliteDb>["sqlite"]): unknown =>
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

describe("date moves ask again", () => {
  const NOW = "2026-11-12T20:00:00.000Z"
  const MOVED = { startDate: "2026-09-21", endDateCalculated: "2026-09-23" }
  const SAME = { startDate: "2026-09-14", endDateCalculated: "2026-09-16" }

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
    await persistScheduleDateUpdates(database, "p1", moves, "t2")

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
    ]), "t2")
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
    await persistScheduleDateUpdates(database, "p1", new Map([["moved", MOVED], ["unmoved", SAME]]), "t2")
    expect(sqlite.prepare("SELECT schedule_task_id, source_start_date, response_status, responded_at, assigned_at FROM schedule_task_assignees ORDER BY rowid").all()).toEqual([
      { schedule_task_id: "moved", source_start_date: "2026-09-21", response_status: "pending", responded_at: null, assigned_at: "t2" },
      { schedule_task_id: "unmoved", source_start_date: "2026-09-14", response_status: "confirmed", responded_at: "s0", assigned_at: "a0" },
    ])
  })

  it("asks again when a dependency or calendar change moves the dates", async () => {
    const { database, confirmations } = scheduled([["confirmed", "confirmed", 1, "u1"]])
    const leading = database.prepare("UPDATE projects SET name = name WHERE id = 'p1'")
    await runWithDateUpdates(database, leading, "p1", new Map([["confirmed", MOVED]]), "t2", "failed")
    expect(confirmations()).toEqual([reasked("confirmed")])
  })
})

describe("schedule date writes", () => {
  it("go through the store's date moves only", () => {
    const store = readFileSync("src/lib/domain/schedule/store.ts", "utf8")
    const helperStart = store.indexOf("function dateMoveStatements(")
    const helper = store.slice(helperStart, store.indexOf("\n}\n", helperStart))
    const rest = store.replace(helper, "")
    // Raw SQL outside the helper never sets a schedule item's dates...
    expect(rest).not.toMatch(/UPDATE schedule_tasks[^`]*\b(start_date|workdays|end_date_calculated)\s*=/)
    // ...and drizzle updates can't: their value type leaves the date columns out.
    expect(store).toContain('type TaskUpdate = Omit<Partial<TaskInsert>, "startDate" | "workdays" | "endDateCalculated">')
    for (const update of rest.split(".update(scheduleTasks)").slice(1)) {
      const set = update.slice(0, update.indexOf(".where("))
      expect(set).not.toMatch(/\b(startDate|workdays|endDateCalculated)\b/)
    }
    expect(helper).toContain("start_date = ?, end_date_calculated = ?, workdays = COALESCE(?, workdays)")
  })
})

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

describe("confirmation status writes", () => {
  const files = sourceFiles("src").map((path) => ({ path, text: readFileSync(path, "utf8") }))

  it("only schedule/store.ts writes schedule_tasks", () => {
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
    expect(writers.filter((path) => literal.test(readFileSync(path, "utf8")))).toEqual([])
  })
})
