import { describe, expect, it } from "vitest"
import {
  dominantScrollAxis,
  lockWheelToDominantAxis,
  normalizeWheelDelta,
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
})
