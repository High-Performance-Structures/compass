import { format, parseISO } from "date-fns"
import { describe, expect, it } from "vitest"

import { formatDate } from "@/lib/format"
import type { ScheduleTaskData, TaskDependencyData } from "@/lib/schedule/types"

import {
  DEPENDENCY_ERRORS,
  bulkTaskIds,
  criticalPathChanges,
  dependenciesWithin,
  isDependencyType,
  isTaskStatus,
  nextSortOrder,
  ownerSchedulePaths,
  propagateFrom,
  recalculateAll,
  scheduleSummary,
  schedulePaths,
  taskEditValues,
  taskWithProgress,
  validateDependency,
} from "../rules"

function task(id: string, overrides: Partial<ScheduleTaskData> = {}): ScheduleTaskData {
  return {
    id,
    projectId: "project-1",
    title: `Task ${id}`,
    startDate: "2026-11-02",
    workdays: 2,
    endDateCalculated: "2026-11-03",
    phase: "framing",
    displayColor: "blue",
    status: "PENDING",
    isCriticalPath: false,
    isMilestone: false,
    percentComplete: 0,
    assignedTo: null,
    sortOrder: 0,
    createdAt: "2026-10-30T00:00:00.000Z",
    updatedAt: "2026-10-30T00:00:00.000Z",
    ...overrides,
  }
}

function dependency(
  id: string,
  predecessorId: string,
  successorId: string,
  overrides: Partial<TaskDependencyData> = {}
): TaskDependencyData {
  return { id, predecessorId, successorId, type: "FS", lagDays: 0, ...overrides }
}

describe("validateDependency", () => {
  const projectTaskIds = new Set(["a", "b", "c"])
  const dependencies = [dependency("d1", "a", "b"), dependency("d2", "b", "c")]

  it("reports problems in the order users have always seen them", () => {
    expect(
      validateDependency({ predecessorId: "a", successorId: "a", projectTaskIds, dependencies })
    ).toBe(DEPENDENCY_ERRORS.self)
    expect(
      validateDependency({ predecessorId: "a", successorId: "x", projectTaskIds, dependencies })
    ).toBe(DEPENDENCY_ERRORS.outsideProject)
    expect(
      validateDependency({ predecessorId: "a", successorId: "b", projectTaskIds, dependencies })
    ).toBe(DEPENDENCY_ERRORS.duplicate)
    expect(
      validateDependency({ predecessorId: "c", successorId: "a", projectTaskIds, dependencies })
    ).toBe(DEPENDENCY_ERRORS.cycle)
    expect(
      validateDependency({ predecessorId: "a", successorId: "c", projectTaskIds, dependencies })
    ).toBeNull()
  })

  it("ignores the dependency being edited", () => {
    // Re-pointing d1 (a -> b) to b -> a would only cycle through d1 itself.
    expect(
      validateDependency({
        predecessorId: "b",
        successorId: "a",
        projectTaskIds,
        dependencies: [dependency("d1", "a", "b")],
        replacingId: "d1",
      })
    ).toBeNull()
    expect(
      validateDependency({
        predecessorId: "a",
        successorId: "b",
        projectTaskIds,
        dependencies,
        replacingId: "d1",
      })
    ).toBeNull()
    expect(
      validateDependency({
        predecessorId: "c",
        successorId: "a",
        projectTaskIds,
        dependencies,
        replacingId: "d1",
      })
    ).toBeNull()
    expect(
      validateDependency({
        predecessorId: "c",
        successorId: "a",
        projectTaskIds,
        dependencies,
        replacingId: "other",
      })
    ).toBe(DEPENDENCY_ERRORS.cycle)
  })
})

describe("dependenciesWithin", () => {
  it("keeps only dependencies whose both ends are in the set", () => {
    const rows = [dependency("d1", "a", "b"), dependency("d2", "a", "z"), dependency("d3", "z", "b")]
    expect(dependenciesWithin(new Set(["a", "b"]), rows).map((row) => row.id)).toEqual(["d1"])
  })
})

describe("date propagation", () => {
  it("moves successors after a predecessor moves", () => {
    const tasks = [
      task("a", { startDate: "2026-11-02", workdays: 3, endDateCalculated: "2026-11-04" }),
      task("b", { startDate: "2026-11-05", workdays: 1, endDateCalculated: "2026-11-05" }),
    ]
    const moved = tasks.map((row) =>
      row.id === "a" ? { ...row, startDate: "2026-11-09", endDateCalculated: "2026-11-11" } : row
    )
    const updates = propagateFrom("a", moved, [dependency("d1", "a", "b")], [])
    expect(updates.get("b")).toEqual({ startDate: "2026-11-12", endDateCalculated: "2026-11-12" })
  })

  it("leaves a consistent schedule unchanged", () => {
    const tasks = [
      task("a", { startDate: "2026-11-02", workdays: 3, endDateCalculated: "2026-11-04" }),
      task("b", { startDate: "2026-11-05", workdays: 1, endDateCalculated: "2026-11-05" }),
    ]
    expect(recalculateAll(tasks, [dependency("d1", "a", "b")], []).size).toBe(0)
  })
})

describe("criticalPathChanges", () => {
  it("returns only the flags that changed", () => {
    const tasks = [
      task("a", { workdays: 3, isCriticalPath: true }),
      task("b", { workdays: 1, isCriticalPath: false }),
    ]
    const changes = criticalPathChanges(tasks, [dependency("d1", "a", "b")])
    expect(changes).toEqual([{ id: "b", isCriticalPath: true }])
  })
})

describe("bulkTaskIds", () => {
  it("trims, de-duplicates, and enforces the limit", () => {
    expect(bulkTaskIds([" a", "a ", "", "b"], "Update")).toEqual({ ids: ["a", "b"] })
    expect(bulkTaskIds(["  "], "Update")).toEqual({ error: "Select at least one schedule item" })
    const many = Array.from({ length: 201 }, (_, index) => `t${index}`)
    expect(bulkTaskIds(many, "Update")).toEqual({
      error: "Update no more than 200 schedule items at a time",
    })
    expect(bulkTaskIds(many, "Delete")).toEqual({
      error: "Delete no more than 200 schedule items at a time",
    })
  })
})

describe("small rules", () => {
  it("appends after the last sort order", () => {
    expect(nextSortOrder([])).toBe(0)
    expect(nextSortOrder([0, 4, 7])).toBe(8)
  })

  it("recognizes statuses and dependency types", () => {
    expect(isTaskStatus("IN_PROGRESS")).toBe(true)
    expect(isTaskStatus("DONE")).toBe(false)
    expect(isDependencyType("SF")).toBe(true)
    expect(isDependencyType("XX")).toBe(false)
  })

  it("shows COMPLETE as 100% and caps the rest at 99%", () => {
    expect(taskWithProgress({ ...task("a"), status: "COMPLETE", percentComplete: 10 }).percentComplete).toBe(100)
    expect(taskWithProgress({ ...task("a"), status: "IN_PROGRESS", percentComplete: 100 }).percentComplete).toBe(99)
  })

  it("lists the paths a schedule change revalidates", () => {
    expect(schedulePaths("p")).toEqual([
      "/dashboard/projects/p/schedule",
      "/dashboard/projects/p/todos",
      "/dashboard",
      "/dashboard/schedule",
    ])
    expect(ownerSchedulePaths("p").slice(-2)).toEqual([
      "/preview/projects/p/owner",
      "/preview/projects/p/owner/schedule",
    ])
  })
})

describe("scheduleSummary", () => {
  it("counts statuses and averages progress", () => {
    const summary = scheduleSummary([
      task("a", { status: "COMPLETE", percentComplete: 100, isCriticalPath: true }),
      task("b", { status: "IN_PROGRESS", percentComplete: 50 }),
      task("c", { status: "BLOCKED", percentComplete: 0 }),
      task("d"),
    ])
    expect(summary).toMatchObject({
      total: 4,
      completed: 1,
      inProgress: 1,
      blocked: 1,
      pending: 1,
      overallPercent: 38,
    })
    expect(summary.criticalPath).toEqual([
      { id: "a", title: "Task a", status: "COMPLETE", startDate: "2026-11-02", endDate: "2026-11-03" },
    ])
  })
})

describe("taskEditValues", () => {
  const base = {
    workdays: 3,
    status: "PENDING" as const,
    percentComplete: 0,
    times: null,
    assignedUserId: null,
    confirmationRequired: false,
    restartConfirmation: null,
    acceptChangeProposal: false,
    now: "2026-10-30T12:00:00.000Z",
  }

  it("writes only the fields the edit names", () => {
    expect(taskEditValues({ ...base, data: { title: "Frame walls", notes: "  " } })).toEqual({
      title: "Frame walls",
      notes: null,
      workdays: 3,
      status: "PENDING",
      percentComplete: 0,
      updatedAt: base.now,
    })
  })

  it("clears the assignee account when the assignee is cleared", () => {
    expect(taskEditValues({ ...base, data: { assignedTo: null } })).toMatchObject({
      assignedTo: null,
      assignedUserId: null,
    })
  })

  it("restarts confirmation and clears a pending proposal", () => {
    expect(
      taskEditValues({
        ...base,
        data: { confirmationRequired: true },
        confirmationRequired: true,
        restartConfirmation: { status: "unavailable", requestedAt: base.now },
      })
    ).toMatchObject({
      confirmationRequired: true,
      confirmationStatus: "unavailable",
      confirmationRequestedAt: base.now,
      proposedStartDate: null,
      proposalSubmittedAt: null,
    })
  })

  it("turns an accepted proposal into a draft awaiting confirmation", () => {
    expect(
      taskEditValues({ ...base, data: {}, confirmationRequired: true, acceptChangeProposal: true })
    ).toMatchObject({ confirmationStatus: "pending", confirmationRequestedAt: base.now })
    expect(taskEditValues({ ...base, data: {}, acceptChangeProposal: true })).toMatchObject({
      confirmationStatus: "not_requested",
      confirmationRequestedAt: null,
    })
  })
})

describe("schedule date labels", () => {
  // The schedule views replaced their date-fns "MMM d, yyyy" copies with the
  // shared formatter; the visible text must not change.
  it("matches the previous date-fns output for date-only values", () => {
    for (let month = 1; month <= 12; month += 1) {
      for (const day of [1, 9, 28]) {
        const value = `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
        expect(formatDate(value, "medium", value)).toBe(format(parseISO(value), "MMM d, yyyy"))
      }
    }
  })

  it("shows an unreadable value as stored", () => {
    expect(formatDate("not a date", "medium", "not a date")).toBe("not a date")
  })
})
