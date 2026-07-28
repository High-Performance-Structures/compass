import { describe, expect, it } from "vitest"
import { orderScheduleTasks } from "../task-ordering"
import type { ScheduleTaskData } from "../types"

function task(
  id: string,
  startDate: string,
  endDateCalculated: string,
  sortOrder: number,
  title = id
): ScheduleTaskData {
  return {
    id,
    projectId: "project",
    title,
    startDate,
    workdays: 1,
    endDateCalculated,
    phase: "construction",
    displayColor: null,
    status: "PENDING",
    isCriticalPath: false,
    isMilestone: false,
    percentComplete: 0,
    assignedTo: null,
    sortOrder,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  }
}

describe("schedule task ordering", () => {
  const tasks = [
    task("third", "2026-08-01", "2026-08-03", 0),
    task("second", "2026-07-02", "2026-07-04", 2),
    task("first", "2026-07-02", "2026-07-03", 1),
  ]

  it("orders chronologically with stable date and saved-order tie breakers", () => {
    expect(
      orderScheduleTasks(tasks, "chronological").map((item) => item.id)
    ).toEqual(["first", "second", "third"])
  })

  it("preserves saved manual order", () => {
    expect(orderScheduleTasks(tasks, "manual").map((item) => item.id)).toEqual([
      "third",
      "first",
      "second",
    ])
  })

  it("does not mutate the source array", () => {
    const originalIds = tasks.map((item) => item.id)
    orderScheduleTasks(tasks, "chronological")
    expect(tasks.map((item) => item.id)).toEqual(originalIds)
  })
})
