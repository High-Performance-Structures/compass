import { describe, expect, it } from "vitest"

import {
  findScheduleConflicts,
  primaryParty,
  scheduleParties,
  scheduleWorkload,
  type ScheduleConflictTask,
} from "@/lib/schedule/conflicts"

const labels = (value: string | null): readonly string[] => scheduleParties(value).map((party) => party.label)

describe("scheduleParties", () => {
  it("splits several names and keeps company suffixes with their company", () => {
    expect(labels("Daniel Vogel, High Performance Structures, Inc., Martine Vogel, Wesley Jones")).toEqual([
      "Daniel Vogel",
      "High Performance Structures, Inc.",
      "Martine Vogel",
      "Wesley Jones",
    ])
    expect(labels("GFGP Framing, LLC")).toEqual(["GFGP Framing, LLC"])
  })

  it("matches spellings of the same company", () => {
    const keys = ["HPHigh Performance Structures, Inc.", "High Performance Structures, Inc.", "high performance structures"].map(
      (value) => scheduleParties(value)[0]?.key,
    )
    expect(new Set(keys)).toEqual(new Set(["high performance structures"]))
    expect(labels("HPHigh Performance Structures, Inc.")).toEqual(["High Performance Structures, Inc."])
  })

  it("keeps ampersands inside a name and skips bare initials", () => {
    expect(labels("Ted's Plumbing & Hydronics")).toEqual(["Ted's Plumbing & Hydronics"])
    expect(labels("DVHPMVWJ+1")).toEqual([])
    expect(labels(null)).toEqual([])
  })

  it("applies aliases from settings", () => {
    const settings = { ignoredParties: [], aliases: [{ from: "GP Framing, LLC", to: "GFGP Framing, LLC" }] }
    expect(scheduleParties("GP Framing, LLC", settings)[0]?.key).toBe(scheduleParties("GFGP Framing")[0]?.key)
  })
})

function task(id: string, projectId: string, start: string, end: string, assignedTo: string | null, status = "PENDING"): ScheduleConflictTask {
  return { id, projectId, title: id, startDate: start, endDateCalculated: end, status, assignedTo }
}

describe("findScheduleConflicts", () => {
  const tasks = [
    task("a", "p1", "2026-10-14", "2026-10-16", "Kent Glass LLC"),
    task("b", "p2", "2026-10-16", "2026-10-20", "Kent Glass, LLC"),
    task("c", "p1", "2026-10-15", "2026-10-15", "Kent Glass LLC"),
    task("d", "p3", "2026-10-21", "2026-10-22", "Kent Glass LLC"),
    task("e", "p3", "2026-10-15", "2026-10-15", "Kent Glass LLC", "COMPLETE"),
  ]

  it("flags the same crew on two jobs over the same days, both ways", () => {
    const conflicts = findScheduleConflicts(tasks)
    expect(conflicts.get("a")).toEqual([
      { party: "Kent Glass LLC", otherTaskId: "b", otherProjectId: "p2", otherTitle: "b", from: "2026-10-16", to: "2026-10-16" },
    ])
    expect(conflicts.get("b")?.map((conflict) => conflict.otherTaskId)).toEqual(["a"])
    // Same job, no overlap, or finished: no conflict.
    expect(conflicts.has("c")).toBe(false)
    expect(conflicts.has("d")).toBe(false)
    expect(conflicts.has("e")).toBe(false)
  })

  it("ignores names listed in settings", () => {
    expect(findScheduleConflicts(tasks, { ignoredParties: ["Kent Glass"], aliases: [] }).size).toBe(0)
  })

  it("counts the day's workload and conflicts", () => {
    const conflicts = findScheduleConflicts(tasks)
    expect(scheduleWorkload(tasks, conflicts, "2026-10-15", 2)).toEqual([
      { date: "2026-10-15", active: 2, conflicted: 0 },
      { date: "2026-10-16", active: 2, conflicted: 2 },
    ])
  })
})

describe("primaryParty", () => {
  it("files an item under its first named party", () => {
    expect(primaryParty("Wesley Jones, Kent Glass").label).toBe("Wesley Jones")
    expect(primaryParty(null).label).toBe("Unassigned")
  })
})
