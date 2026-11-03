import { describe, expect, it } from "vitest"
import type { ScheduleTaskData } from "@/lib/schedule/types"
import { DEFAULT_DISPLAY_COLOR_LABELS } from "@/lib/schedule/appearance"
import { NO_CONFLICT_SETTINGS } from "@/lib/schedule/conflicts"
import {
  displayItemDateRanges,
  ganttDisplay,
  localIsoDate,
  storedGanttScrollPosition,
  storedPaletteLabels,
  zoomedColumnWidth,
} from "../gantt-view-rules"

function task(overrides: Partial<ScheduleTaskData>): ScheduleTaskData {
  return {
    id: "t",
    projectId: "p1",
    title: "Item",
    startDate: "2026-11-02",
    workdays: 1,
    endDateCalculated: "2026-11-02",
    phase: "framing",
    displayColor: null,
    status: "PENDING",
    isCriticalPath: false,
    isMilestone: false,
    percentComplete: 0,
    assignedTo: null,
    sortOrder: 0,
    createdAt: "2026-10-01",
    updatedAt: "2026-10-01",
    ...overrides,
  }
}

const baseDisplay = {
  dependencies: [],
  collapsedPhases: new Set<string>(),
  groupByCrew: false,
  phaseGrouping: false,
  conflictSettings: NO_CONFLICT_SETTINGS,
  conflicts: new Map(),
  multipleProjects: false,
  projectById: new Map(),
}

describe("gantt view rules", () => {
  it("zooms by 1.3x within 20 and 300 pixels", () => {
    expect(zoomedColumnWidth(140, "in")).toBe(182)
    expect(zoomedColumnWidth(140, "out")).toBe(108)
    expect(zoomedColumnWidth(290, "in")).toBe(300)
    expect(zoomedColumnWidth(21, "out")).toBe(20)
  })

  it("formats the local calendar date", () => {
    expect(localIsoDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05")
  })

  it("keeps only non-blank saved key meanings over the defaults", () => {
    expect(storedPaletteLabels(null)).toBeNull()
    expect(storedPaletteLabels({ blue: "Inspections", red: "  ", green: 4 })).toEqual({
      ...DEFAULT_DISPLAY_COLOR_LABELS,
      blue: "Inspections",
    })
    expect(storedPaletteLabels(7)).toEqual(DEFAULT_DISPLAY_COLOR_LABELS)
  })

  it("accepts only well-formed saved scroll positions", () => {
    expect(storedGanttScrollPosition({ left: 10, top: 20 })).toEqual({ left: 10, top: 20 })
    expect(storedGanttScrollPosition({ left: 1, top: 2, anchorDate: "2026-11-02" })).toEqual({
      left: 1,
      top: 2,
      anchorDate: "2026-11-02",
    })
    expect(storedGanttScrollPosition({ left: 1, top: 2, anchorDate: "" })).toEqual({ left: 1, top: 2 })
    expect(storedGanttScrollPosition({ left: 1, top: 2, anchorDate: 3 })).toBeNull()
    expect(storedGanttScrollPosition({ left: "1", top: 2 })).toBeNull()
    expect(storedGanttScrollPosition(null)).toBeNull()
  })

  it("lists flat rows, marks conflicts and adds project colors", () => {
    const tasks = [task({ id: "a" }), task({ id: "b", projectId: "p2" })]
    const flat = ganttDisplay({ ...baseDisplay, tasks })
    expect(flat.displayItems.map((item) => item.type)).toEqual(["task", "task"])
    expect(flat.frappeTasks.map((bar) => bar.id)).toEqual(["a", "b"])
    expect(flat.frappeTasks.some((bar) => bar.hasConflict)).toBe(false)

    const marked = ganttDisplay({
      ...baseDisplay,
      tasks,
      conflicts: new Map([["b", []]]),
      multipleProjects: true,
      projectById: new Map([
        ["p2", { id: "p2", name: "Two", projectNumber: null, department: "O" as const, color: "#123456" }],
      ]),
    })
    expect(marked.frappeTasks.find((bar) => bar.id === "b")).toMatchObject({
      hasConflict: true,
      projectColor: "#123456",
    })
    expect(marked.frappeTasks.find((bar) => bar.id === "a")?.projectColor).toBeUndefined()
  })

  it("groups by phase with header rows and gives each row a date range", () => {
    const grouped = ganttDisplay({
      ...baseDisplay,
      phaseGrouping: true,
      tasks: [task({ id: "a", phase: "site" }), task({ id: "b", phase: "framing" })],
    })
    expect(grouped.displayItems.filter((item) => item.type === "phase-header")).toHaveLength(2)
    const ranges = displayItemDateRanges(grouped.displayItems)
    expect(ranges).toHaveLength(grouped.displayItems.length)
    expect(ranges.every((range) => range.startDate === "2026-11-02")).toBe(true)
  })
})
