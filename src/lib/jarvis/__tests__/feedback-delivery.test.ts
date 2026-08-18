import { describe, expect, it } from "vitest"

import {
  feedbackDeliveryGraphEvent,
  feedbackDeliveryGraphUpdate,
  shouldRequestFeedbackDeliveryGraph,
  type FeedbackDeliveryGraphItem,
} from "@/lib/jarvis/feedback-delivery"

const bug: FeedbackDeliveryGraphItem = {
  id: "f43e6e9a-1889-4ce0-9d16-6b6f13d57b58",
  kind: "bug",
  status: "new",
}

describe("Feedback Desk delivery graph routing", () => {
  it("requests one sanitized graph event when a bug becomes triaged", () => {
    expect(shouldRequestFeedbackDeliveryGraph(bug, "triaged")).toBe(true)

    const event = feedbackDeliveryGraphEvent(bug)
    expect(event).toEqual({
      eventType: "feedback.delivery_requested",
      idempotencyKey:
        "feedback-delivery-graph:f43e6e9a-1889-4ce0-9d16-6b6f13d57b58",
      payload: {
        schemaVersion: 1,
        feedbackDeskItemId: bug.id,
        reference: "CFD-f43e6e9a-1889-4ce0-9d16-6b6f13d57b58",
        kind: "bug",
      },
    })
  })

  it("never exports protected feedback fields to the delivery graph", () => {
    const event = feedbackDeliveryGraphEvent({
      ...bug,
      title: "private title",
      description: "private description",
      reporterEmail: "person@example.com",
      channelId: "private-channel",
    })

    expect(JSON.stringify(event)).not.toContain("private title")
    expect(JSON.stringify(event)).not.toContain("private description")
    expect(JSON.stringify(event)).not.toContain("person@example.com")
    expect(JSON.stringify(event)).not.toContain("private-channel")
  })

  it("does not create delivery work for features or non-triaged bugs", () => {
    expect(shouldRequestFeedbackDeliveryGraph(bug, "planned")).toBe(false)
    expect(
      shouldRequestFeedbackDeliveryGraph({ ...bug, kind: "feature" }, "triaged"),
    ).toBe(false)
    expect(
      shouldRequestFeedbackDeliveryGraph({ ...bug, status: "triaged" }, "triaged"),
    ).toBe(false)
  })

  it("requires a complete graph attachment before reporting creation", () => {
    expect(feedbackDeliveryGraphUpdate({ status: "created", graphId: "graph-1" })).toBeNull()
    expect(feedbackDeliveryGraphUpdate({
      status: "created",
      graphId: "graph-1",
      implementationTaskId: "task-1",
      reviewTaskId: "task-2",
      releaseTaskId: "task-3",
    })).toEqual({
      status: "created",
      graphId: "graph-1",
      implementationTaskId: "task-1",
      reviewTaskId: "task-2",
      releaseTaskId: "task-3",
      error: null,
    })
  })

  it("keeps delivery failures observable and retryable without a fake graph", () => {
    expect(feedbackDeliveryGraphUpdate({
      status: "failed",
      error: "Kanban service unavailable",
    })).toEqual({
      status: "failed",
      graphId: null,
      implementationTaskId: null,
      reviewTaskId: null,
      releaseTaskId: null,
      error: "Kanban service unavailable",
    })
    expect(feedbackDeliveryGraphUpdate({ status: "failed" })).toBeNull()
  })

  it("keeps retries attached to the same durable graph request", () => {
    expect(feedbackDeliveryGraphEvent(bug).idempotencyKey).toBe(
      feedbackDeliveryGraphEvent(bug).idempotencyKey,
    )
  })
})