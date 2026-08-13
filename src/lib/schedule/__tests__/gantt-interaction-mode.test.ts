import { describe, expect, it } from "vitest"
import {
  DEFAULT_GANTT_SCROLL_MODE,
  isGanttScrollMode,
  shouldSynchronizeGanttPanes,
} from "@/lib/schedule/gantt-interaction-mode"

describe("Gantt interaction mode", () => {
  it("keeps synchronized scrolling as the default", () => {
    expect(DEFAULT_GANTT_SCROLL_MODE).toBe("default")
    expect(shouldSynchronizeGanttPanes(DEFAULT_GANTT_SCROLL_MODE)).toBe(true)
  })

  it("allows power users to keep their vertical pane positions independent", () => {
    expect(isGanttScrollMode("power")).toBe(true)
    expect(shouldSynchronizeGanttPanes("power")).toBe(false)
  })

  it("rejects unrecognized persisted values", () => {
    expect(isGanttScrollMode("expert")).toBe(false)
  })
})
