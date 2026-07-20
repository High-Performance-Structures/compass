import { describe, expect, it } from "vitest"
import {
  DEFAULT_DISPLAY_COLOR,
  getScheduleItemClasses,
  normalizeDisplayColor,
} from "../appearance"
import { transformToFrappeTasks } from "../gantt-transform"
import type { ScheduleTaskData } from "../types"

describe("normalizeDisplayColor", () => {
  it("uses the Buildertrend-style blue default when no display color is stored", () => {
    expect(normalizeDisplayColor(null)).toBe(DEFAULT_DISPLAY_COLOR)
  })

  it("rejects an unknown stored color instead of producing an unstyled Gantt bar", () => {
    expect(normalizeDisplayColor("mauve")).toBe(DEFAULT_DISPLAY_COLOR)
  })

  it("retains a supported per-item display color", () => {
    expect(normalizeDisplayColor("green")).toBe("green")
  })
})

describe("getScheduleItemClasses", () => {
  it("keeps display color, critical-path, and milestone signals together", () => {
    expect(
      getScheduleItemClasses({
        displayColor: "orange",
        isCriticalPath: true,
        isMilestone: true,
      })
    ).toEqual([
      "display-color-orange",
      "critical-path",
      "milestone",
    ])
  })
})

describe("Gantt transformation", () => {
  it("carries each task's display color and visual flags to the chart", () => {
    const task: ScheduleTaskData = {
      id: "task-1",
      projectId: "project-1",
      title: "Rough framing",
      startDate: "2026-07-20",
      workdays: 5,
      endDateCalculated: "2026-07-24",
      phase: "framing",
      status: "PENDING",
      isCriticalPath: true,
      isMilestone: false,
      percentComplete: 0,
      displayColor: "orange",
      assignedTo: null,
      sortOrder: 0,
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z",
    }

    expect(transformToFrappeTasks([task], [])).toMatchObject([
      {
        id: "task-1",
        custom_class: "display-color-orange",
        displayColor: "orange",
        isCriticalPath: true,
        isMilestone: false,
      },
    ])
  })
})
