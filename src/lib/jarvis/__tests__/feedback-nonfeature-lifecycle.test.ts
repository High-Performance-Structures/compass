import { describe, expect, it } from "vitest"

import {
  feedbackDeliveryGraphEvent,
  feedbackDeliveryRoute,
  feedbackResponseClosure,
  shouldRequestFeedbackDeliveryGraph,
} from "@/lib/jarvis/feedback-delivery"
import {
  feedbackNonEngineeringTransitionIsBlocked,
  feedbackStatusMessage,
} from "@/lib/jarvis/feedback-lifecycle"
import { feedbackRequesterUpdateKind } from "@/lib/jarvis/feedback-lifecycle"
import { feedbackTimeline } from "@/lib/jarvis/feedback-timeline"

const requestId = "feedback-opaque-1"

 describe("Feedback Desk non-feature lifecycle routing", () => {
  it("routes bug reports to engineering and other confirmed non-features to response handling", () => {
    expect(feedbackDeliveryRoute({ kind: "bug" })).toBe("engineering")
    expect(feedbackDeliveryRoute({ kind: "question" })).toBe("response")
    expect(feedbackDeliveryRoute({ kind: "assistance" })).toBe("response")
    expect(feedbackDeliveryRoute({ kind: "general" })).toBe("response")
    expect(feedbackDeliveryRoute({ kind: "feature" })).toBe("feature_decision")
  })

  it("allows an explicitly engineering-required question to use the delivery graph", () => {
    const item = { id: requestId, kind: "question", status: "new" } as const
    expect(feedbackDeliveryRoute({ ...item, requiresEngineering: true })).toBe("engineering")
    expect(shouldRequestFeedbackDeliveryGraph(item, "triaged", "engineering")).toBe(true)
  })

  it("keeps response-only requests out of implementation and deployment statuses", () => {
    for (const status of ["planned", "in_progress", "testing", "deployed"]) {
      expect(feedbackNonEngineeringTransitionIsBlocked({
        kind: "question",
        status: "triaged",
        nextStatus: status,
        deliveryRoute: "response",
      })).toBe("A response-only request cannot enter an engineering lifecycle")
    }
    expect(feedbackNonEngineeringTransitionIsBlocked({
      kind: "question",
      status: "triaged",
      nextStatus: "closed",
      deliveryRoute: "response",
    })).toBeNull()
  })

  it("builds a deterministic accountable closure without claiming deployment", () => {
    expect(feedbackResponseClosure({
      id: requestId,
      kind: "assistance",
      status: "triaged",
    })).toEqual({
      status: "closed",
      message: "The Feedback Desk reviewed this request and provided an accountable response. No Compass code change was required.",
    })
    expect(feedbackStatusMessage("closed", "private request", "question")).toContain(
      "No Compass code change was required",
    )
    expect(feedbackStatusMessage("closed", "private request", "question")).not.toContain(
      "private request",
    )
  })

  it("uses one opaque, idempotent graph request for each engineering-required item", () => {
    const event = feedbackDeliveryGraphEvent({
      id: requestId,
      kind: "question",
      status: "new",
      title: "private title",
      description: "private description",
      reporterEmail: "private@example.com",
      channelId: "private-channel",
    })
    expect(event.idempotencyKey).toBe(`feedback-delivery-graph:${requestId}`)
    expect(event.payload).toEqual({
      schemaVersion: 1,
      feedbackDeskItemId: requestId,
      reference: `CFD-${requestId}`,
      kind: "question",
    })
    expect(JSON.stringify(event)).not.toContain("private title")
    expect(JSON.stringify(event)).not.toContain("private description")
    expect(JSON.stringify(event)).not.toContain("private@example.com")
    expect(JSON.stringify(event)).not.toContain("private-channel")
  })

  it("publishes requester updates for graph creation and failure milestones", () => {
    expect(feedbackRequesterUpdateKind("triaged", "triaged", null, null, "created")).toBe(
      "delivery_graph_created",
    )
    expect(feedbackRequesterUpdateKind("triaged", "triaged", null, null, "failed")).toBe(
      "delivery_graph_failed",
    )
  })

  it("shows graph milestones in the protected My Requests timeline", () => {
    const timeline = feedbackTimeline(
      {
        title: "Private request",
        status: "triaged",
        createdAt: "2026-08-21T12:00:00.000Z",
      },
      [{
        eventType: "feedback.status_updated",
        payload: "{}",
        result: JSON.stringify({
          status: "triaged",
          notificationKind: "delivery_graph_created",
          message: "Engineering work has been set up.",
          updatedAt: "2026-08-21T12:01:00.000Z",
        }),
        createdAt: "2026-08-21T12:01:00.000Z",
        completedAt: "2026-08-21T12:01:00.000Z",
      }],
    )
    expect(timeline).toHaveLength(2)
    expect(timeline[1]).toMatchObject({
      label: "Engineering work set up",
      message: "Engineering work has been set up.",
    })
  })
})
