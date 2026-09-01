import { describe, expect, it } from "vitest"

import {
  summarizeScheduleShift,
  validateScheduleShiftReason,
} from "@/lib/schedule/shift-tracking"
import type { ScheduleTaskData } from "@/lib/schedule/types"

function task(
  id: string,
  startDate: string,
  endDateCalculated: string
): ScheduleTaskData {
  return {
    id,
    projectId: "project-1",
    title: id,
    startDate,
    workdays: 1,
    endDateCalculated,
    phase: "finish",
    displayColor: null,
    status: "PENDING",
    isCriticalPath: false,
    isMilestone: false,
    percentComplete: 0,
    assignedTo: null,
    sortOrder: 0,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  }
}

describe("validateScheduleShiftReason", () => {
  it("trims and accepts a useful reason", () => {
    expect(validateScheduleShiftReason("  Owner requested the move  ")).toEqual({
      success: true,
      reason: "Owner requested the move",
    })
  })

  it("rejects a missing reason", () => {
    expect(validateScheduleShiftReason(" ")).toEqual({
      success: false,
      error: "Enter a schedule shift reason (at least 3 characters)",
    })
  })
})

describe("summarizeScheduleShift", () => {
  it("detects when a shift pushes the project finish later", () => {
    const tasks = [
      task("countertops", "2026-09-01", "2026-09-04"),
      task("plumbing", "2026-09-07", "2026-09-11"),
    ]
    const updates = new Map([
      [
        "plumbing",
        { startDate: "2026-09-14", endDateCalculated: "2026-09-18" },
      ],
    ])

    expect(summarizeScheduleShift(tasks, updates)).toEqual({
      affectedItemCount: 1,
      previousProjectEnd: "2026-09-11",
      nextProjectEnd: "2026-09-18",
      extendsProjectEnd: true,
    })
  })

  it("ignores recalculation entries whose dates did not change", () => {
    const tasks = [task("countertops", "2026-09-01", "2026-09-04")]
    const updates = new Map([
      [
        "countertops",
        { startDate: "2026-09-01", endDateCalculated: "2026-09-04" },
      ],
    ])

    expect(summarizeScheduleShift(tasks, updates).affectedItemCount).toBe(0)
  })
})
