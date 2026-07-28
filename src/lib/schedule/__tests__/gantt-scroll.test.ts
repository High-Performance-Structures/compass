import { describe, expect, it } from "vitest"
import {
  dominantScrollAxis,
  ganttRowIndexForScrollTop,
  lockWheelToDominantAxis,
  normalizeWheelDelta,
  paddingToIncludeDate,
  synchronizedScrollTop,
} from "../gantt-scroll"

describe("Gantt dominant-axis scrolling", () => {
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

  it("normalizes line and page wheel deltas", () => {
    expect(normalizeWheelDelta(2, 1, 500)).toBe(32)
    expect(normalizeWheelDelta(-1, 2, 500)).toBe(-500)
    expect(normalizeWheelDelta(24, 0, 500)).toBe(24)
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
})
