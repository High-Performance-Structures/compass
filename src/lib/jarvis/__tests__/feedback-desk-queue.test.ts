import { describe, expect, it } from "vitest"

import {
  feedbackDeskQueueItems,
  feedbackDeskQueueViews,
  knownFeedbackDeskQueueGithubFilter,
  knownFeedbackDeskQueueViewId,
} from "@/lib/jarvis/feedback-desk-queue"

const items = [
  {
    assignedToUserId: null,
    githubIssueCreationApprovedAt: null,
    githubIssueUrl: null,
    id: "bug-overdue",
    kind: "bug",
    overdue: true,
    status: "triaged",
    title: "Calendar save fails",
  },
  {
    assignedToUserId: "staff-1",
    githubIssueCreationApprovedAt: null,
    githubIssueUrl: null,
    id: "feature-decision",
    kind: "feature",
    overdue: false,
    status: "needs_info",
    title: "Add a new report",
  },
  {
    assignedToUserId: "staff-1",
    githubIssueCreationApprovedAt: "2026-08-12T00:00:00.000Z",
    githubIssueUrl: null,
    id: "bug-approved",
    kind: "bug",
    overdue: false,
    status: "in_progress",
    title: "Notification delay",
  },
  {
    assignedToUserId: "staff-1",
    githubIssueCreationApprovedAt: null,
    githubIssueUrl: "https://github.com/High-Performance-Structures/compass/issues/1",
    id: "resolved",
    kind: "bug",
    overdue: false,
    status: "deployed",
    title: "Deployed fix",
  },
] as const

describe("Feedback Desk queue", () => {
  it("offers focused views that distinguish bug flow from feature priority decisions", () => {
    expect(feedbackDeskQueueViews(items)).toEqual([
      { id: "attention", label: "Needs attention", count: 2 },
      { id: "bugs", label: "Bug workflow", count: 2 },
      { id: "feature_decisions", label: "Feature decisions", count: 1 },
      { id: "active", label: "Active requests", count: 3 },
      { id: "resolved", label: "Resolved requests", count: 1 },
      { id: "all", label: "All requests", count: 4 },
    ])
  })

  it("filters by queue, kind, status, GitHub state, and protected title search", () => {
    expect(feedbackDeskQueueItems(items, {
      github: "approved",
      kind: "bug",
      query: "notification",
      status: "all",
      view: "bugs",
    }).map((item) => item.id)).toEqual(["bug-approved"])
  })

  it("normalizes unexpected queue filter values safely", () => {
    expect(knownFeedbackDeskQueueViewId("unexpected")).toBe("attention")
    expect(knownFeedbackDeskQueueGithubFilter("unexpected")).toBe("all")
  })

  it("keeps resolved items out of active workflow views", () => {
    expect(feedbackDeskQueueItems(items, {
      github: "all",
      kind: "all",
      query: "",
      status: "all",
      view: "active",
    }).map((item) => item.id)).toEqual([
      "bug-overdue",
      "feature-decision",
      "bug-approved",
    ])
  })
})
