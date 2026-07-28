import { describe, expect, it } from "vitest"

import {
  feedbackStatusLabel,
  feedbackDraftPullRequestMessage,
  feedbackRequesterUpdateKind,
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

  it("keeps a draft pull request link in the requester-only update", () => {
    expect(
      feedbackDraftPullRequestMessage(
        "Daily Log printing",
        "https://github.com/High-Performance-Structures/compass/pull/42",
      ),
    ).toContain("/pull/42")
  })

  it("only emits private requester updates for lifecycle or draft-PR changes", () => {
    expect(
      feedbackRequesterUpdateKind("triaged", "triaged", null, null),
    ).toBeNull()
    expect(
      feedbackRequesterUpdateKind("triaged", "planned", null, null),
    ).toBe("status_changed")
    expect(
      feedbackRequesterUpdateKind(
        "in_progress",
        "in_progress",
        null,
        "https://github.com/High-Performance-Structures/compass/pull/42",
      ),
    ).toBe("draft_pull_request_opened")
    expect(
      feedbackRequesterUpdateKind(
        "in_progress",
        "in_progress",
        "https://github.com/High-Performance-Structures/compass/pull/42",
        "https://github.com/High-Performance-Structures/compass/pull/43",
      ),
    ).toBe("draft_pull_request_updated")
  })
})
