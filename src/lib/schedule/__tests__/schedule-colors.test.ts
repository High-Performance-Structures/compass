import { describe, expect, it } from "vitest"

import {
  schedulePhaseColor,
  scheduleTaskColor,
} from "@/lib/schedule/schedule-colors"
import type { ScheduleTaskData } from "@/lib/schedule/types"

const task: ScheduleTaskData = {
  id: "task-1",
  projectId: "project-1",
  title: "Electrical rough",
  startDate: "2026-07-20",
  workdays: 3,
  endDateCalculated: "2026-07-22",
  phase: "Rough MEP",
  status: "IN_PROGRESS",
  isCriticalPath: false,
  isMilestone: false,
  percentComplete: 30,
  assignedTo: null,
  sortOrder: 0,
  createdAt: "2026-07-20T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:00.000Z",
}

describe("schedule colors", () => {
  it("assigns stable colors to imported phase names", () => {
    expect(schedulePhaseColor("Rough MEP", "hps")).toBe(
      schedulePhaseColor("Rough MEP", "hps")
    )
  })

  it("can switch from phase colors to status colors", () => {
    const phaseColor = scheduleTaskColor(task, {
      mode: "phase",
      palette: "hps",
      phaseColors: {},
    })
    const statusColor = scheduleTaskColor(task, {
      mode: "status",
      palette: "hps",
      phaseColors: {},
    })

    expect(statusColor).toBe("#1769aa")
    expect(statusColor).not.toBe(phaseColor)
  })

  it("uses a custom swatch for a matching phase", () => {
    expect(
      scheduleTaskColor(task, {
        mode: "phase",
        palette: "hps",
        phaseColors: { "rough mep": "#123456" },
      })
    ).toBe("#123456")
  })

  it("keeps status colors standardized when phase swatches exist", () => {
    expect(
      scheduleTaskColor(task, {
        mode: "status",
        palette: "hps",
        phaseColors: { "rough mep": "#123456" },
      })
    ).toBe("#1769aa")
  })
})
