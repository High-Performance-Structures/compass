export type FeedbackDeliveryGraphItem = Readonly<{
  id: string
  kind: string
  status: string
  title?: string
  description?: string
  reporterEmail?: string | null
  channelId?: string | null
}>

export type FeedbackDeliveryGraphEvent = Readonly<{
  eventType: "feedback.delivery_requested"
  idempotencyKey: string
  payload: Readonly<{
    schemaVersion: 1
    feedbackDeskItemId: string
    reference: string
    kind: "bug"
  }>
}>

export type FeedbackDeliveryGraphUpdate = Readonly<{
  status: "created" | "failed"
  graphId: string | null
  implementationTaskId: string | null
  reviewTaskId: string | null
  releaseTaskId: string | null
  error: string | null
}>

export function shouldRequestFeedbackDeliveryGraph(
  item: Pick<FeedbackDeliveryGraphItem, "kind" | "status">,
  nextStatus: string,
): boolean {
  return item.kind === "bug" &&
    item.status !== "triaged" &&
    nextStatus === "triaged"
}

export function feedbackDeliveryGraphEvent(
  item: FeedbackDeliveryGraphItem,
): FeedbackDeliveryGraphEvent {
  return {
    eventType: "feedback.delivery_requested",
    idempotencyKey: `feedback-delivery-graph:${item.id}`,
    payload: {
      schemaVersion: 1,
      feedbackDeskItemId: item.id,
      reference: `CFD-${item.id}`,
      kind: "bug",
    },
  }
}

export function feedbackDeliveryGraphUpdate(
  input: Readonly<{
    status: "created" | "failed"
    graphId?: string
    implementationTaskId?: string
    reviewTaskId?: string
    releaseTaskId?: string
    error?: string
  }>,
): FeedbackDeliveryGraphUpdate | null {
  if (input.status === "failed") {
    const error = input.error?.trim()
    return error
      ? {
          status: "failed",
          graphId: input.graphId ?? null,
          implementationTaskId: input.implementationTaskId ?? null,
          reviewTaskId: input.reviewTaskId ?? null,
          releaseTaskId: input.releaseTaskId ?? null,
          error,
        }
      : null
  }

  if (
    !input.graphId ||
    !input.implementationTaskId ||
    !input.reviewTaskId ||
    !input.releaseTaskId
  ) {
    return null
  }
  return {
    status: "created",
    graphId: input.graphId,
    implementationTaskId: input.implementationTaskId,
    reviewTaskId: input.reviewTaskId,
    releaseTaskId: input.releaseTaskId,
    error: null,
  }
}
