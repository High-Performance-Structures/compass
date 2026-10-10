import { describe, expect, it } from "vitest"
import { transformWithPhaseGroups } from "@/lib/schedule/gantt-transform"
import type { ScheduleTaskData, TaskDependencyData } from "@/lib/schedule/types"

function task(id: string, phase: string, startDate: string): ScheduleTaskData {
  return {
    id,
    projectId: "project-1",
    title: id,
    startDate,
    workdays: 2,
    endDateCalculated: startDate,
    phase,
    displayColor: null,
    status: "PENDING",
    isCriticalPath: false,
    isMilestone: false,
    percentComplete: 0,
    assignedTo: null,
    sortOrder: 0,
    createdAt: "2026-10-01",
    updatedAt: "2026-10-01",
  }
}

const tasks = [
  task("dig", "sitework", "2026-10-01"),
  task("forms", "foundation", "2026-10-05"),
  task("pour", "foundation", "2026-10-07"),
  task("walls", "framing", "2026-10-12"),
]
const dependencies: TaskDependencyData[] = [
  { id: "dep-1", predecessorId: "pour", successorId: "walls", type: "FS", lagDays: 0 },
]

function chartRowForEachListRow(collapsed: ReadonlySet<string>): void {
  const { frappeTasks, displayItems } = transformWithPhaseGroups(
    tasks,
    dependencies,
    new Set(collapsed)
  )
  // The list and chart scroll pixel-for-pixel, so row N of the list must be
  // row N of the chart: a phase header needs its own summary bar.
  expect(frappeTasks.map((row) => row.id)).toEqual(
    displayItems.map((item) =>
      item.type === "task" ? item.task.id : `phase-${item.phase}`
    )
  )
}

describe("transformWithPhaseGroups", () => {
  it("gives every list row, phase headers included, a chart row", () => {
    chartRowForEachListRow(new Set())
    chartRowForEachListRow(new Set(["foundation"]))
  })

  it("draws dependency arrows to a phase bar only when the phase is collapsed", () => {
    const expanded = transformWithPhaseGroups(tasks, dependencies, new Set())
    expect(expanded.frappeTasks.find((row) => row.id === "phase-framing")?.dependencies).toBe("")
    expect(expanded.frappeTasks.find((row) => row.id === "walls")?.dependencies).toBe("pour")

    const collapsed = transformWithPhaseGroups(tasks, dependencies, new Set(["foundation"]))
    expect(collapsed.frappeTasks.find((row) => row.id === "walls")?.dependencies).toBe("phase-foundation")
  })
})
