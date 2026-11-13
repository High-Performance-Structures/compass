import { afterEach, beforeAll, describe, expect, it } from "vitest"

import { preloadSources, readSource, SOURCE_SCAN_TIMEOUT_MS, sourceFiles as sharedSourceFiles } from "@/test/source-tree"

import { migratedDb } from "@/lib/domain/__tests__/sqlite-d1"
import { insertRow } from "@/test/migrated-database"
import { assigneeResponseMachine, assigneeResponseParts } from "@/lib/domain/schedule/assignee-response-machine"
import { SCHEDULE_ASSIGNEE_RESPONSES } from "@/lib/domain/schedule/statuses"
import { recordAssigneeResponse, resetTaskAssigneesQuery } from "@/lib/domain/schedule/store"
import { machineProblems, nextState } from "@/lib/shared/state-machine"

describe("assignee response machine", () => {
  it("is well formed", () => {
    expect(machineProblems(assigneeResponseMachine)).toEqual([])
  })

  it("lets an assignee answer or change their answer, and staff re-ask, from any state", () => {
    for (const from of SCHEDULE_ASSIGNEE_RESPONSES) {
      for (const event of ["confirm", "decline", "propose", "reset"] as const) {
        expect(nextState(assigneeResponseMachine, from, event).ok).toBe(true)
      }
    }
  })

  it("writes the date and duration parts with the answer", () => {
    expect(assigneeResponseParts("confirm")).toEqual({
      responseStatus: "confirmed", dateResponseStatus: "confirmed", durationResponseStatus: "confirmed",
    })
    expect(assigneeResponseParts("propose", { date: false, duration: true })).toEqual({
      responseStatus: "proposed", dateResponseStatus: "pending", durationResponseStatus: "proposed",
    })
    expect(assigneeResponseParts("reset")).toEqual({
      responseStatus: "pending", dateResponseStatus: "pending", durationResponseStatus: "pending",
    })
  })

  // Every value Compass code or a migration has written (migration 0140's
  // default and multi-assignee.ts). Production was not read here: the
  // integrator checks SELECT DISTINCT on the three columns before merge.
  it("lists every value Compass writes", () => {
    const written = ["pending", "confirmed", "declined", "proposed"]
    expect(written.filter((value) => !includes(SCHEDULE_ASSIGNEE_RESPONSES, value))).toEqual([])
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

function seed(): ReturnType<typeof migratedDb> {
  // Production's schema (every migration), with the parents its keys need.
  current = migratedDb()
  insertRow(current.sqlite, "organizations", { id: "org" })
  insertRow(current.sqlite, "users", { id: "u1" })
  insertRow(current.sqlite, "projects", { id: "proj", organization_id: "org" })
  insertRow(current.sqlite, "schedule_tasks", {
    id: "t1", project_id: "proj", start_date: "2026-09-14", workdays: 3, end_date_calculated: "2026-09-16",
  })
  insertRow(current.sqlite, "project_source_record_participants", { id: "p1", organization_id: "org", project_id: "proj" })
  current.sqlite.exec(`INSERT INTO schedule_task_assignees (id, schedule_task_id, participant_id, source_start_date, source_workdays,
      source_end_date, assigned_at, created_at, updated_at)
    VALUES ('a1', 't1', 'p1', '2026-09-14', 3, '2026-09-16', 't0', 't0', 't0')`)
  return current
}

const PROPOSAL = { proposedStartDate: null, proposedWorkdays: null, responseMessage: null }
const CONFIRM = { event: "confirm", ...assigneeResponseParts("confirm"), ...PROPOSAL } as const
const DECLINE = { event: "decline", ...assigneeResponseParts("decline"), ...PROPOSAL } as const
const SEEN = { id: "a1", assignedAt: "t0", respondedAt: null, startDate: "2026-09-14", workdays: 3 }

function answer(respondedAt: string) {
  return { respondedAt, respondedByUserId: "u1", responseSource: "compass" }
}

function row(sqlite: ReturnType<typeof migratedDb>["sqlite"]): unknown {
  return sqlite.prepare("SELECT response_status, date_response_status, responded_at FROM schedule_task_assignees WHERE id = 'a1'").get()
}

describe("recordAssigneeResponse", () => {
  it("records an answer given against the current dates", async () => {
    const { sqlite, db } = seed()
    expect(await recordAssigneeResponse(db, SEEN, CONFIRM, answer("t1"))).toBe("recorded")
    expect(row(sqlite)).toEqual({ response_status: "confirmed", date_response_status: "confirmed", responded_at: "t1" })
  })

  it("lands a double submit once", async () => {
    const { db } = seed()
    expect(await recordAssigneeResponse(db, SEEN, CONFIRM, answer("t1"))).toBe("recorded")
    expect(await recordAssigneeResponse(db, SEEN, CONFIRM, answer("t2"))).toBe("already_recorded")
    // A different answer sent from the same stale screen does not overwrite it.
    expect(await recordAssigneeResponse(db, SEEN, DECLINE, answer("t2"))).toBe("schedule_changed")
    // Changing the answer from what is now on screen still works.
    expect(await recordAssigneeResponse(db, { ...SEEN, respondedAt: "t1" }, CONFIRM, answer("t3"))).toBe("recorded")
  })

  it("does not overwrite a reschedule that landed first", async () => {
    const { sqlite, db } = seed()
    sqlite.exec("UPDATE schedule_tasks SET start_date = '2026-09-21' WHERE id = 't1'")
    await db.batch([resetTaskAssigneesQuery(db, "t1", { startDate: "2026-09-21", workdays: 3, endDate: "2026-09-23" }, "t1")])
    expect(await recordAssigneeResponse(db, SEEN, CONFIRM, answer("t2"))).toBe("schedule_changed")
    expect(row(sqlite)).toEqual({ response_status: "pending", date_response_status: "pending", responded_at: null })
  })

  it("does not land against dates staff changed, even before the reset", async () => {
    const { sqlite, db } = seed()
    sqlite.exec("UPDATE schedule_tasks SET workdays = 5 WHERE id = 't1'")
    expect(await recordAssigneeResponse(db, SEEN, CONFIRM, answer("t1"))).toBe("schedule_changed")
  })

  it("does not land when staff re-asked at the same dates", async () => {
    const { sqlite, db } = seed()
    await recordAssigneeResponse(db, SEEN, CONFIRM, answer("t1"))
    await db.batch([resetTaskAssigneesQuery(db, "t1", { startDate: "2026-09-14", workdays: 3, endDate: "2026-09-16" }, "t5")])
    expect(await recordAssigneeResponse(db, { ...SEEN, respondedAt: "t1" }, DECLINE, answer("t6"))).toBe("schedule_changed")
    expect(row(sqlite)).toEqual({ response_status: "pending", date_response_status: "pending", responded_at: null })
  })
})

const SOURCE_OPTIONS = { skipDirectories: ["__tests__"], include: /^(?!.*\.test\.tsx?$).*\.(ts|tsx)$/ }

function sourceFiles(dir: string): readonly string[] {
  return sharedSourceFiles(dir, SOURCE_OPTIONS)
}

// Read the tree once for this file, as setup (see @/test/source-tree).
beforeAll(() => preloadSources("src", SOURCE_OPTIONS), SOURCE_SCAN_TIMEOUT_MS)

describe("assignee response writes", () => {
  const files = sourceFiles("src").map((path) => ({ path, text: readSource(path) }))

  it("only schedule/store.ts writes the table", () => {
    const writers = files.filter(({ text }) =>
      /\.(update|insert)\(scheduleTaskAssignees\)|(UPDATE|INSERT INTO)\s+schedule_task_assignees/i.test(text))
    expect(writers.map(({ path }) => path)).toEqual(["src/lib/domain/schedule/store.ts"])
  })

  it("never sets a response status from a literal", () => {
    const literal = /\b(responseStatus|dateResponseStatus|durationResponseStatus):\s*["'`]|\b(response_status|date_response_status|duration_response_status)\s*=\s*'/
    // Files that touch this table (work-calendar events have their own response_status).
    const touching = files.filter(({ text }) => /scheduleTaskAssignees|schedule_task_assignees/.test(text))
    expect(touching.length).toBeGreaterThan(3)
    expect(touching.filter(({ text }) => literal.test(text)).map(({ path }) => path)).toEqual([])
  })
})
