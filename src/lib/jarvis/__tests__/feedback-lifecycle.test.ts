import { describe, expect, it } from "vitest"

import {
  feedbackStatusLabel,
  feedbackStaffStage,
  feedbackDraftPullRequestMessage,
  feedbackRequesterUpdateKind,
  feedbackStatusMessage,
  feedbackStatusUsesEmail,
  feedbackIsOverdue,
  feedbackSlaTarget,
  knownFeedbackPriority,
  knownFeedbackStatus,
} from "@/lib/jarvis/feedback-lifecycle"
import { feedbackGithubLinkAction } from "@/lib/jarvis/feedback-maintenance"

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

  it("maps detailed workflow states to the four staff-facing stages", () => {
    expect(feedbackStaffStage("new")).toBe("submitted")
    expect(feedbackStaffStage("triaged")).toBe("triaged")
    expect(feedbackStaffStage("needs_info")).toBe("triaged")
    expect(feedbackStaffStage("in_progress")).toBe("in_process")
    expect(feedbackStaffStage("testing")).toBe("in_process")
    expect(feedbackStaffStage("deployed")).toBe("implemented")
    expect(feedbackStaffStage("closed")).toBe("implemented")
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

  it("sets tighter response targets for higher priorities", () => {
    const start = new Date("2026-08-05T12:00:00.000Z")
    expect(feedbackSlaTarget("urgent", start)).toBe("2026-08-05T16:00:00.000Z")
    expect(feedbackSlaTarget("normal", start)).toBe("2026-08-08T12:00:00.000Z")
    expect(feedbackSlaTarget("low", start)).toBe("2026-08-12T12:00:00.000Z")
  })

  it("flags overdue open work but never resolved work", () => {
    const now = new Date("2026-08-05T12:00:00.000Z")
    expect(feedbackIsOverdue("in_progress", "2026-08-05T11:59:59.000Z", now)).toBe(true)
    expect(feedbackIsOverdue("deployed", "2026-08-05T11:59:59.000Z", now)).toBe(false)
    expect(feedbackIsOverdue("new", null, now)).toBe(false)
  })

  it("normalizes unexpected stored lifecycle values safely", () => {
    expect(knownFeedbackStatus("unexpected")).toBe("new")
    expect(knownFeedbackPriority("unexpected")).toBe("normal")
  })

  it("requires review before creating a missing historical GitHub issue", () => {
    expect(feedbackGithubLinkAction({
      featurePriorityApprovedAt: null,
      githubIssueUrl: null,
      githubIssueCreationApprovedAt: null,
      kind: "bug",
      status: "new",
    })).toBe("review")
    expect(feedbackGithubLinkAction({
      featurePriorityApprovedAt: null,
      githubIssueUrl: null,
      githubIssueCreationApprovedAt: "2026-08-05T12:00:00.000Z",
      kind: "bug",
      status: "new",
    })).toBe("create")
    expect(feedbackGithubLinkAction({
      featurePriorityApprovedAt: null,
      githubIssueUrl: null,
      githubIssueCreationApprovedAt: "2026-08-05T12:00:00.000Z",
      kind: "feature",
      status: "new",
    })).toBe("review")
    expect(feedbackGithubLinkAction({
      featurePriorityApprovedAt: "2026-08-05T12:00:00.000Z",
      githubIssueUrl: null,
      githubIssueCreationApprovedAt: "2026-08-05T12:00:00.000Z",
      kind: "feature",
      status: "new",
    })).toBe("create")
    expect(feedbackGithubLinkAction({
      featurePriorityApprovedAt: null,
      githubIssueUrl: "https://github.com/example/compass/issues/1",
      githubIssueCreationApprovedAt: null,
      kind: "bug",
      status: "closed",
    })).toBe("repair")
    expect(feedbackGithubLinkAction({
      featurePriorityApprovedAt: null,
      githubIssueUrl: null,
      githubIssueCreationApprovedAt: null,
      kind: "bug",
      status: "deployed",
    })).toBe("skip")
    expect(feedbackGithubLinkAction({
      featurePriorityApprovedAt: null,
      githubIssueUrl: null,
      githubIssueCreationApprovedAt: null,
      kind: "bug",
      status: "closed",
    })).toBe("skip")
  })
})
