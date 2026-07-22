import { describe, expect, it } from "vitest"

import {
  enforceDependencyDates,
  enforceDependencyDatesFrom,
  lagDaysForStartDate,
} from "@/lib/schedule/propagate-dates"
import type {
  DependencyType,
  ScheduleTaskData,
  TaskDependencyData,
} from "@/lib/schedule/types"

function task(
  id: string,
  startDate: string,
  endDateCalculated: string,
  workdays = 5
): ScheduleTaskData {
  return {
    id,
    projectId: "project-1",
    title: id,
    startDate,
    workdays,
    endDateCalculated,
    phase: "sitework",
    status: "PENDING",
    isCriticalPath: false,
    isMilestone: false,
    percentComplete: 0,
    assignedTo: null,
    sortOrder: 0,
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
  }
}

function dependency(
  id: string,
  predecessorId: string,
  successorId: string,
  type: DependencyType,
  lagDays = 0
): TaskDependencyData {
  return { id, predecessorId, successorId, type, lagDays }
}

describe("schedule dependency enforcement", () => {
  it("uses the latest constraint when an item has multiple predecessors", () => {
    const result = enforceDependencyDates(
      [
        task("early", "2026-07-06", "2026-07-10"),
        task("late", "2026-07-13", "2026-07-17"),
        task("successor", "2026-07-06", "2026-07-10"),
      ],
      [
        dependency("late-link", "late", "successor", "FS"),
        dependency("early-link", "early", "successor", "FS"),
      ]
    )

    expect(result.cycleDetected).toBe(false)
    expect(result.updatedTasks.get("successor")).toEqual({
      startDate: "2026-07-20",
      endDateCalculated: "2026-07-24",
    })
  })

  it("enforces a start-to-start predecessor and lag", () => {
    const result = enforceDependencyDates(
      [
        task("predecessor", "2026-07-20", "2026-07-24"),
        task("successor", "2026-07-06", "2026-07-10"),
      ],
      [dependency("link", "predecessor", "successor", "SS", 2)]
    )

    expect(result.updatedTasks.get("successor")?.startDate).toBe("2026-07-22")
  })

  it("enforces a negative lag as lead time", () => {
    const result = enforceDependencyDates(
      [
        task("predecessor", "2026-07-20", "2026-07-24"),
        task("successor", "2026-07-06", "2026-07-10"),
      ],
      [dependency("link", "predecessor", "successor", "FS", -2)]
    )

    expect(result.updatedTasks.get("successor")?.startDate).toBe("2026-07-23")
  })

  it("derives finish-to-start lag from a manually entered start date", () => {
    const predecessor = task(
      "predecessor",
      "2026-07-27",
      "2026-07-29",
      3
    )
    const successor = task("successor", "2026-08-10", "2026-08-14")

    const lagDays = lagDaysForStartDate(
      predecessor,
      successor,
      "FS",
      successor.startDate
    )
    const result = enforceDependencyDates(
      [predecessor, successor],
      [dependency("link", predecessor.id, successor.id, "FS", lagDays)]
    )

    expect(lagDays).toBe(7)
    expect(result.updatedTasks.has(successor.id)).toBe(false)
  })

  it("derives finish-to-finish lag while preserving the chosen duration", () => {
    const predecessor = task(
      "predecessor",
      "2026-07-27",
      "2026-07-31",
      5
    )
    const successor = task("successor", "2026-08-10", "2026-08-12", 3)

    const lagDays = lagDaysForStartDate(
      predecessor,
      successor,
      "FF",
      successor.startDate
    )
    const result = enforceDependencyDates(
      [predecessor, successor],
      [dependency("link", predecessor.id, successor.id, "FF", lagDays)]
    )

    expect(lagDays).toBe(8)
    expect(result.updatedTasks.has(successor.id)).toBe(false)
  })

  it("chooses the controlling date across mixed dependency types", () => {
    const result = enforceDependencyDates(
      [
        task("fs", "2026-07-06", "2026-07-10"),
        task("ss", "2026-07-20", "2026-07-24"),
        task("successor", "2026-07-06", "2026-07-10"),
      ],
      [
        dependency("fs-link", "fs", "successor", "FS"),
        dependency("ss-link", "ss", "successor", "SS"),
      ]
    )

    expect(result.updatedTasks.get("successor")?.startDate).toBe("2026-07-20")
  })

  it("derives a successor start from a finish-to-finish link", () => {
    const result = enforceDependencyDates(
      [
        task("predecessor", "2026-07-20", "2026-07-24"),
        task("successor", "2026-07-06", "2026-07-08", 3),
      ],
      [dependency("link", "predecessor", "successor", "FF")]
    )

    expect(result.updatedTasks.get("successor")).toEqual({
      startDate: "2026-07-22",
      endDateCalculated: "2026-07-24",
    })
  })

  it("refuses to recalculate a circular dependency graph", () => {
    const result = enforceDependencyDates(
      [
        task("one", "2026-07-06", "2026-07-10"),
        task("two", "2026-07-13", "2026-07-17"),
      ],
      [
        dependency("one-two", "one", "two", "FS"),
        dependency("two-one", "two", "one", "FS"),
      ]
    )

    expect(result.cycleDetected).toBe(true)
    expect(result.updatedTasks.size).toBe(0)
  })

  it("limits an edit recalculation to the changed item and its descendants", () => {
    const result = enforceDependencyDatesFrom(
      "edited",
      [
        task("unrelated-predecessor", "2026-07-06", "2026-07-10"),
        task("unrelated-successor", "2026-07-06", "2026-07-10"),
        task("edited", "2026-07-20", "2026-07-24"),
        task("edited-successor", "2026-07-06", "2026-07-10"),
      ],
      [
        dependency(
          "unrelated-link",
          "unrelated-predecessor",
          "unrelated-successor",
          "FS"
        ),
        dependency("edited-link", "edited", "edited-successor", "FS"),
      ]
    )

    expect(result.updatedTasks.has("unrelated-successor")).toBe(false)
    expect(result.updatedTasks.get("edited-successor")?.startDate).toBe(
      "2026-07-27"
    )
  })
})
