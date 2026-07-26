import { describe, expect, it } from "vitest"

import {
  feedbackStatusLabel,
  feedbackStatusMessage,
  feedbackStatusUsesEmail,
} from "@/lib/jarvis/feedback-lifecycle"

describe("Feedback Desk lifecycle", () => {
  it("uses staff-facing labels for every visible lifecycle state", () => {
    expect(feedbackStatusLabel("new")).toBe("New")
    expect(feedbackStatusLabel("needs_info")).toBe(
      "Information needed"
    )
    expect(feedbackStatusLabel("in_progress")).toBe("In progress")
    expect(feedbackStatusLabel("testing")).toBe(
      "Ready for testing"
    )
    expect(feedbackStatusLabel("deployed")).toBe("Deployed")
  })

  it("creates an understandable default update message", () => {
    expect(
      feedbackStatusMessage("in_progress", "Daily Log printing")
    ).toContain("Development has started")
    expect(
      feedbackStatusMessage("deployed", "Daily Log printing")
    ).toContain("deployed to Compass")
  })

  it("reserves email for updates that need attention or close the loop", () => {
    expect(feedbackStatusUsesEmail("triaged")).toBe(false)
    expect(feedbackStatusUsesEmail("in_progress")).toBe(false)
    expect(feedbackStatusUsesEmail("needs_info")).toBe(true)
    expect(feedbackStatusUsesEmail("testing")).toBe(true)
    expect(feedbackStatusUsesEmail("deployed")).toBe(true)
  })
})
