import { describe, expect, it } from "vitest"

import {
  getMessageAlignmentClass,
  getNewestScrollTop,
  getPreservedScrollTop,
  getHistoryLoadError,
  isHistoryRequestCurrent,
  isHistoryScrollRestoreCurrent,
  isAtNewestEdge,
} from "../message-list-behavior"

describe("message list behavior", () => {
  it("aligns only the current user's messages to the right", () => {
    expect(getMessageAlignmentClass("user-1", "user-1")).toBe("justify-end")
    expect(getMessageAlignmentClass("user-1", "user-2")).toBe("justify-start")
    expect(getMessageAlignmentClass("user-1", null)).toBe("justify-start")
    expect(getMessageAlignmentClass(null, "user-1")).toBe("justify-start")
  })

  it("opens at the newest scroll position", () => {
    expect(getNewestScrollTop({ clientHeight: 400, scrollHeight: 1_000 })).toBe(600)
    expect(getNewestScrollTop({ clientHeight: 400, scrollHeight: 250 })).toBe(0)
  })

  it("preserves the visible messages after older history is prepended", () => {
    expect(
      getPreservedScrollTop({
        scrollTop: 180,
        previousScrollHeight: 900,
        nextScrollHeight: 1_260,
      }),
    ).toBe(540)
  })

  it("shows the newest control only when the newest edge is out of view", () => {
    expect(
      isAtNewestEdge({ scrollTop: 560, clientHeight: 400, scrollHeight: 1_000 }),
    ).toBe(false)
    expect(
      isAtNewestEdge({ scrollTop: 576, clientHeight: 400, scrollHeight: 1_000 }, 24),
    ).toBe(true)
  })

  it("ignores history completions invalidated by newest navigation", () => {
    expect(isHistoryRequestCurrent(4, 4)).toBe(true)
    expect(isHistoryRequestCurrent(4, 5)).toBe(false)
  })

  it("keeps history errors available for an accessible retry state", () => {
    expect(getHistoryLoadError(new Error("History request failed"))).toBe(
      "History request failed",
    )
    expect(getHistoryLoadError({})).toBe("Unable to load older messages.")
  })

  it("does not restore request-start scroll over a later manual scroll", () => {
    expect(isHistoryScrollRestoreCurrent(4, 4, 12, 12)).toBe(true)
    expect(isHistoryScrollRestoreCurrent(4, 4, 12, 13)).toBe(false)
  })
})
