import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { sqliteDb } from "@/lib/domain/__tests__/sqlite-d1"
import { confirmationMachine, staffConfirmationEvent } from "@/lib/domain/schedule/confirmation-machine"
import { SCHEDULE_CONFIRMATION_STATUSES } from "@/lib/domain/schedule/statuses"
import { recordConfirmationAnswer, rejectConfirmationProposal } from "@/lib/domain/schedule/store"
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
    proposal_note text, proposal_submitted_at text, updated_at text NOT NULL)`)
  current.sqlite.prepare(`INSERT INTO schedule_tasks VALUES ('t1', 'u1', '2026-09-14', 3, 1, ?, 'r0', NULL, NULL, NULL, NULL, NULL, 't0')`).run(status)
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
