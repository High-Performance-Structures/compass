export const feedbackDeliveryOperationalFixture = {
  item: {
    id: "f43e6e9a-1889-4ce0-9d16-6b6f13d57b58",
    kind: "bug",
    status: "triaged",
    title: "[redacted request title]",
    description: "[redacted request description]",
    reporterEmail: null,
    channelId: null,
  },
  event: {
    eventType: "feedback.delivery_requested",
    idempotencyKey:
      "feedback-delivery-graph:f43e6e9a-1889-4ce0-9d16-6b6f13d57b58",
  },
  graphAttachment: {
    status: "created",
    graphId: "graph-fixture-1",
    implementationTaskId: "task-implementation-fixture-1",
    reviewTaskId: "task-review-fixture-1",
    releaseTaskId: "task-release-fixture-1",
  },
  retry: {
    firstAckStatus: "pending",
    nextAttempt: 2,
  },
} as const
