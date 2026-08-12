import { describe, expect, it } from "vitest"

import { feedbackOperationsSummary } from "@/lib/jarvis/feedback-operations-summary"

describe("Feedback Desk operations summary", () => {
  it("keeps bug flow visible while reserving feature implementation for leadership review", () => {
    const summary = feedbackOperationsSummary({
      bridgeFailedEvents: 2,
      items: [
        {
          assignedToUserId: null,
          kind: "bug",
          overdue: true,
          status: "triaged",
        },
        {
          assignedToUserId: "",
          kind: "bug",
          overdue: false,
          status: "in_progress",
        },
        {
          assignedToUserId: null,
          kind: "feature",
          overdue: false,
          status: "triaged",
        },
        {
          assignedToUserId: null,
          kind: "feature",
          overdue: true,
          status: "closed",
        },
      ],
    })

    expect(summary).toMatchObject({
      failedBridgeEvents: 2,
      openBugs: 2,
      openFeatures: 1,
      overdue: 1,
      unassigned: 3,
    })
    expect(summary.needsAttention).toBe(true)
    expect(summary.featureDecisionMessage).toContain("leadership")
    expect(summary.featureDecisionMessage).toContain("before implementation")
  })

  it("marks only pre-implementation features as awaiting leadership review", () => {
    const summary = feedbackOperationsSummary({
      bridgeFailedEvents: 0,
      items: [
        {
          assignedToUserId: "staff-1",
          kind: "feature",
          overdue: false,
          status: "triaged",
        },
        {
          assignedToUserId: "staff-2",
          kind: "feature",
          overdue: false,
          status: "in_progress",
        },
      ],
    })

    expect(summary.featureDecisionRequests).toBe(1)
    expect(summary.needsAttention).toBe(true)
    expect(summary.featureDecisionMessage).toContain("1 request awaits")
  })
})
