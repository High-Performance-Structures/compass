import { describe, expect, it } from "vitest"
import { scheduleItemClickAction } from "../gantt-click"

describe("scheduleItemClickAction", () => {
  it("highlights on a first click or tap", () => {
    expect(scheduleItemClickAction("mouse", false)).toBe("highlight")
    expect(scheduleItemClickAction("touch", false)).toBe("highlight")
  })

  it("opens only when a highlighted item is tapped, not clicked", () => {
    expect(scheduleItemClickAction("touch", true)).toBe("open")
    expect(scheduleItemClickAction("pen", true)).toBe("open")
    expect(scheduleItemClickAction("pen", false)).toBe("highlight")
    expect(scheduleItemClickAction("mouse", true)).toBe("highlight")
  })
})
