import { describe, expect, it } from "vitest"

import {
  feedbackFeatureGithubIssueCreationIsBlocked,
  feedbackFeatureGithubIssueApprovalIsStale,
  feedbackFeatureTransitionRequiresPriorityApproval,
  feedbackFeatureTransitionIsBlocked,
  isFeatureImplementationStatus,
} from "@/lib/jarvis/feedback-feature-priority"

describe("Feedback Desk feature priority gate", () => {
  it("requires an explicit leadership decision before a feature first enters implementation", () => {
    expect(feedbackFeatureTransitionRequiresPriorityApproval({
      currentStatus: "triaged",
      kind: "feature",
      nextStatus: "planned",
    })).toBe(true)
    expect(feedbackFeatureTransitionRequiresPriorityApproval({
      currentStatus: "needs_info",
      kind: "feature",
      nextStatus: "in_progress",
    })).toBe(true)
  })

  it("does not block bugs or a feature already in the implementation workflow", () => {
    expect(feedbackFeatureTransitionRequiresPriorityApproval({
      currentStatus: "triaged",
      kind: "bug",
      nextStatus: "planned",
    })).toBe(false)
    expect(feedbackFeatureTransitionRequiresPriorityApproval({
      currentStatus: "planned",
      kind: "feature",
      nextStatus: "testing",
    })).toBe(false)
  })

  it("identifies the statuses that represent an implementation commitment", () => {
    expect(isFeatureImplementationStatus("planned")).toBe(true)
    expect(isFeatureImplementationStatus("in_progress")).toBe(true)
    expect(isFeatureImplementationStatus("testing")).toBe(true)
    expect(isFeatureImplementationStatus("deployed")).toBe(true)
    expect(isFeatureImplementationStatus("triaged")).toBe(false)
  })

  it("blocks an unapproved feature from every implementation status", () => {
    expect(feedbackFeatureTransitionIsBlocked({
      currentStatus: "triaged",
      featurePriorityApprovedAt: null,
      kind: "feature",
      nextStatus: "planned",
    })).toBe(true)
    expect(feedbackFeatureTransitionIsBlocked({
      currentStatus: "planned",
      featurePriorityApprovedAt: null,
      kind: "feature",
      nextStatus: "deployed",
    })).toBe(true)
    expect(feedbackFeatureTransitionIsBlocked({
      currentStatus: "triaged",
      featurePriorityApprovedAt: "2026-08-12T00:00:00.000Z",
      kind: "feature",
      nextStatus: "planned",
    })).toBe(false)
  })

  it("requires a leadership decision before creating a GitHub issue for a feature", () => {
    expect(feedbackFeatureGithubIssueCreationIsBlocked({
      featurePriorityApprovedAt: null,
      kind: "feature",
    })).toBe(true)
    expect(feedbackFeatureGithubIssueCreationIsBlocked({
      featurePriorityApprovedAt: "2026-08-12T00:00:00.000Z",
      kind: "feature",
    })).toBe(false)
    expect(feedbackFeatureGithubIssueCreationIsBlocked({
      featurePriorityApprovedAt: null,
      kind: "bug",
    })).toBe(false)
  })

  it("identifies a stale feature issue approval after priority revocation", () => {
    expect(feedbackFeatureGithubIssueApprovalIsStale({
      featurePriorityApprovedAt: null,
      githubIssueCreationApprovedAt: "2026-08-12T00:00:00.000Z",
      kind: "feature",
    })).toBe(true)
    expect(feedbackFeatureGithubIssueApprovalIsStale({
      featurePriorityApprovedAt: "2026-08-12T00:00:00.000Z",
      githubIssueCreationApprovedAt: "2026-08-12T00:00:00.000Z",
      kind: "feature",
    })).toBe(false)
    expect(feedbackFeatureGithubIssueApprovalIsStale({
      featurePriorityApprovedAt: null,
      githubIssueCreationApprovedAt: "2026-08-12T00:00:00.000Z",
      kind: "bug",
    })).toBe(false)
  })
})
