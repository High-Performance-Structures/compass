import { describe, expect, it } from "vitest"

import {
  transformToFrappeTasks,
  transformWithPhaseGroups,
} from "@/lib/schedule/gantt-transform"
import type { ScheduleTaskData, TaskDependencyData } from "@/lib/schedule/types"

function task(id: string, phase: string): ScheduleTaskData {
  return {
    id,
    projectId: "project-1",
    title: id,
    startDate: "2026-07-20",
    workdays: 5,
    endDateCalculated: "2026-07-24",
    phase,
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

describe("phase-grouped Gantt rows", () => {
  it("keeps one chart row for every task-list row", () => {
    const result = transformWithPhaseGroups(
      [task("layout", "preconstruction"), task("excavate", "sitework")],
      [],
      new Set()
    )

    expect(result.frappeTasks).toHaveLength(result.displayItems.length)
  })

  it("keeps every dependency type visible on the chart", () => {
    const tasks = [task("first", "sitework"), task("second", "foundation")]
    const dependency: TaskDependencyData = {
      id: "link",
      predecessorId: "first",
      successorId: "second",
      type: "SS",
      lagDays: 0,
    }

    const result = transformToFrappeTasks(tasks, [dependency])

    expect(result.find((item) => item.id === "second")?.dependencies).toBe(
      "first"
    )
  })

  it("uses the task's stored percent complete", () => {
    const inProgress = { ...task("progress", "framing"), percentComplete: 35 }

    expect(transformToFrappeTasks([inProgress], [])[0].progress).toBe(35)
  })
})
