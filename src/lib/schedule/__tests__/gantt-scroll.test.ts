import { describe, expect, it } from "vitest"
import {
  canScrollGanttAxis,
  clampGanttScrollOffset,
  centeredGanttRowScrollTop,
  centeredTimelineScrollLeft,
  dominantScrollAxis,
  ganttWheelIntent,
  ganttRowIndexForScrollTop,
  lockWheelToDominantAxis,
  nearestScheduleRowIndexForDate,
  normalizeWheelDelta,
  paddingToIncludeDate,
  persistGanttScrollPosition,
  synchronizedScrollTop,
} from "../gantt-scroll"

describe("Gantt dominant-axis scrolling", () => {
  it("persists a seeded viewport before the scroll handler returns", () => {
    const values = new Map<string, string>()
    const storage = {
      setItem(key: string, value: string): void {
        values.set(key, value)
      },
    }
    const position = { left: 640, top: 192, anchorDate: "2026-08-24" }

    persistGanttScrollPosition(storage, "schedule-scroll", position)

    expect(values.get("schedule-scroll")).toBe(JSON.stringify(position))
  })

  it("removes incidental horizontal movement from a vertical gesture", () => {
    expect(lockWheelToDominantAxis(9, 64)).toEqual({
      deltaX: 0,
      deltaY: 64,
    })
  })

  it("preserves intentional horizontal navigation", () => {
    expect(lockWheelToDominantAxis(-72, 6)).toEqual({
      deltaX: -72,
      deltaY: 0,
    })
  })

  it("chooses one axis for diagonal drag gestures", () => {
    expect(dominantScrollAxis(18, 31)).toBe("vertical")
    expect(dominantScrollAxis(42, 12)).toBe("horizontal")
  })

  it("keeps ordinary wheel scrolling vertical despite horizontal noise", () => {
    expect(ganttWheelIntent(72, 6, false)).toEqual({
      axis: "vertical",
      delta: 6,
    })
  })

  it("uses Shift+wheel for horizontal timeline navigation", () => {
    expect(ganttWheelIntent(0, 64, true)).toEqual({
      axis: "horizontal",
      delta: 64,
    })
    expect(ganttWheelIntent(-72, 6, true)).toEqual({
      axis: "horizontal",
      delta: -72,
    })
  })

  it("ignores horizontal trackpad movement without Shift", () => {
    expect(ganttWheelIntent(72, 0, false)).toBeNull()
  })

  it("normalizes line and page wheel deltas", () => {
    expect(normalizeWheelDelta(2, 1, 500)).toBe(32)
    expect(normalizeWheelDelta(-1, 2, 500)).toBe(-500)
    expect(normalizeWheelDelta(24, 0, 500)).toBe(24)
  })

  it("keeps the Gantt scroll position within the resized viewport", () => {
    expect(clampGanttScrollOffset(1_200, 2_000, 1_000)).toBe(1_000)
    expect(clampGanttScrollOffset(-20, 2_000, 1_000)).toBe(0)
    expect(clampGanttScrollOffset(500, 600, 800)).toBe(0)
  })

  it("releases wheel events to the page when a Gantt pane reaches its edge", () => {
    expect(canScrollGanttAxis(0, 1_000, 400, -64)).toBe(false)
    expect(canScrollGanttAxis(600, 1_000, 400, 64)).toBe(false)
    expect(canScrollGanttAxis(300, 1_000, 400, 64)).toBe(true)
  })

  it("maps independently sized scroll panes to the same relative row", () => {
    expect(synchronizedScrollTop(450, 1_100, 200, 900, 100)).toBe(400)
    expect(synchronizedScrollTop(900, 1_100, 200, 900, 100)).toBe(800)
  })

  it("extends the timeline enough for Today to be reachable", () => {
    expect(
      paddingToIncludeDate("2026-08-01", "2026-09-01", "2026-07-28", 7)
    ).toEqual(["11d", "7d"])
    expect(
      paddingToIncludeDate("2025-08-01", "2025-09-01", "2026-07-28", 7)
    ).toEqual(["7d", "337d"])
  })

  it("follows the row below the fixed Gantt header", () => {
    expect(ganttRowIndexForScrollTop(0, 10)).toBe(0)
    expect(ganttRowIndexForScrollTop(84, 10)).toBe(0)
    expect(ganttRowIndexForScrollTop(133, 10)).toBe(1)
    expect(ganttRowIndexForScrollTop(10_000, 10)).toBe(9)
    expect(ganttRowIndexForScrollTop(0, 0)).toBeNull()
  })

  it("selects work active today before nearby schedule rows", () => {
    expect(
      nearestScheduleRowIndexForDate(
        [
          { startDate: "2025-02-01", endDate: "2025-02-10" },
          { startDate: "2026-07-28", endDate: "2026-08-03" },
          { startDate: "2026-08-04", endDate: "2026-08-08" },
        ],
        "2026-07-29"
      )
    ).toBe(1)
  })

  it("falls forward to upcoming work, then back to the latest past work", () => {
    const rows = [
      { startDate: "2025-02-01", endDate: "2025-02-10" },
      { startDate: "2026-08-04", endDate: "2026-08-08" },
      { startDate: "2026-08-01", endDate: "2026-08-02" },
    ]
    expect(nearestScheduleRowIndexForDate(rows, "2026-07-29")).toBe(2)
    expect(nearestScheduleRowIndexForDate(rows, "2027-01-01")).toBe(1)
    expect(nearestScheduleRowIndexForDate([], "2026-07-29")).toBeNull()
  })

  it("centers the relevant row while respecting scroll boundaries", () => {
    expect(
      centeredGanttRowScrollTop({
        rowIndex: 10,
        clientHeight: 400,
        scrollHeight: 1_200,
      })
    ).toBe(389)
    expect(
      centeredGanttRowScrollTop({
        rowIndex: 0,
        clientHeight: 400,
        scrollHeight: 1_200,
      })
    ).toBe(0)
    expect(
      centeredGanttRowScrollTop({
        rowIndex: 40,
        clientHeight: 400,
        scrollHeight: 1_200,
      })
    ).toBe(800)
  })

  it("centers a selected date in the timeline beside sticky labels", () => {
    expect(
      centeredTimelineScrollLeft({
        dayOffset: 50,
        dayWidth: 20,
        labelWidth: 240,
        clientWidth: 1_000,
        scrollWidth: 2_400,
      })
    ).toBe(630)
  })

  it("clamps timeline navigation to both scroll boundaries", () => {
    expect(
      centeredTimelineScrollLeft({
        dayOffset: 0,
        dayWidth: 20,
        labelWidth: 240,
        clientWidth: 1_000,
        scrollWidth: 2_400,
      })
    ).toBe(0)
    expect(
      centeredTimelineScrollLeft({
        dayOffset: 200,
        dayWidth: 20,
        labelWidth: 240,
        clientWidth: 1_000,
        scrollWidth: 2_400,
      })
    ).toBe(1_400)
  })
})
