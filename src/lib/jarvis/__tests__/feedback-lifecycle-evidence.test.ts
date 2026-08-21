import { describe, expect, it } from "vitest"

import {
  feedbackBugTransitionIsBlocked,
  feedbackDeliveryGraphIsComplete,
  feedbackEngineeringTransitionIsBlocked,
} from "@/lib/jarvis/feedback-lifecycle-evidence"

const completeGraph = {
  deliveryGraphId: "graph-1",
  deliveryGraphStatus: "created",
  deliveryGraphImplementationTaskId: "implementation-1",
  deliveryGraphReviewTaskId: "review-1",
  deliveryGraphReleaseTaskId: "release-1",
}

const bug = {
  kind: "bug",
  status: "triaged",
  githubIssueUrl: "https://github.com/example/compass/issues/42",
  githubDraftPullRequestUrl: null,
  ...completeGraph,
}

function blocked(nextStatus: string, overrides: Record<string, unknown> = {}): string | null {
  return feedbackBugTransitionIsBlocked({
    ...bug,
    nextStatus,
    ...overrides,
  })
}

describe("Feedback Desk lifecycle evidence", () => {
  it("requires every durable graph ID before a delivery is complete", () => {
    expect(feedbackDeliveryGraphIsComplete(completeGraph)).toBe(true)
    expect(feedbackDeliveryGraphIsComplete({
      ...completeGraph,
      deliveryGraphReleaseTaskId: null,
    })).toBe(false)
    expect(feedbackDeliveryGraphIsComplete({
      ...completeGraph,
      deliveryGraphStatus: "failed",
    })).toBe(false)
  })

  it("fails closed when a bug enters planned without a complete graph", () => {
    expect(blocked("planned", { deliveryGraphStatus: null })).toBe(
      "A bug must have a complete durable delivery graph before it is planned",
    )
  })

  it("requires an implementation graph for in-progress work", () => {
    expect(blocked("in_progress", {
      deliveryGraphImplementationTaskId: null,
    })).toBe(
      "A bug must have a complete durable delivery graph before implementation starts",
    )
  })

  it("requires the review task and pull request before testing", () => {
    expect(blocked("testing", { githubDraftPullRequestUrl: null })).toBe(
      "A bug must have a pull request and complete durable review evidence before testing",
    )
    expect(blocked("testing", {
      githubDraftPullRequestUrl: "https://github.com/example/compass/pull/43",
      deliveryGraphReviewTaskId: null,
    })).toBe(
      "A bug must have a pull request and complete durable review evidence before testing",
    )
  })

  it("requires release evidence before deployment", () => {
    expect(blocked("deployed", {
      githubDraftPullRequestUrl: "https://github.com/example/compass/pull/43",
      deliveryGraphReleaseTaskId: null,
    })).toBe(
      "A bug must have a pull request and complete durable release evidence before deployment",
    )
  })

  it("allows an evidence-backed bug transition", () => {
    expect(blocked("testing", {
      githubDraftPullRequestUrl: "https://github.com/example/compass/pull/43",
    })).toBeNull()
  })

  it("does not apply bug evidence gates to features", () => {
    expect(blocked("deployed", {
      kind: "feature",
      deliveryGraphStatus: null,
      githubDraftPullRequestUrl: null,
    })).toBeNull()
  })

  it("applies the same evidence gates to an explicitly engineering-required question", () => {
    expect(feedbackEngineeringTransitionIsBlocked({
      kind: "question",
      status: "triaged",
      nextStatus: "in_progress",
      deliveryRoute: "engineering",
      ...completeGraph,
      githubDraftPullRequestUrl: null,
    })).toBeNull()
    expect(feedbackEngineeringTransitionIsBlocked({
      kind: "question",
      status: "triaged",
      nextStatus: "in_progress",
      deliveryRoute: "engineering",
      ...completeGraph,
      deliveryGraphImplementationTaskId: null,
      githubDraftPullRequestUrl: null,
    })).toBe(
      "An engineering request must have a complete durable delivery graph before implementation starts",
    )
  })
})
