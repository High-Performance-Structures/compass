export type FeedbackDeliveryGraphItem = Readonly<{
  id: string
  kind: string
  status: string
  title?: string
  description?: string
  reporterEmail?: string | null
  channelId?: string | null
}>

export type FeedbackDeliveryRoute =
  | "engineering"
  | "response"
  | "feature_decision"

export type FeedbackResponseClosure = Readonly<{
  status: "closed"
  message: string
}>

export function feedbackDeliveryRoute(
  item: Readonly<{
    kind: string
    requiresEngineering?: boolean
  }>,
): FeedbackDeliveryRoute {
  if (item.kind === "feature") return "feature_decision"
  if (item.kind === "bug" || item.requiresEngineering === true) {
    return "engineering"
  }
  return "response"
}

export function feedbackResponseClosure(
  item: Pick<FeedbackDeliveryGraphItem, "id" | "kind" | "status">,
): FeedbackResponseClosure {
  void item
  return {
    status: "closed",
    message:
      "The Feedback Desk reviewed this request and provided an accountable response. No Compass code change was required.",
  }
}

export type FeedbackDeliveryGraphEvent = Readonly<{
  eventType: "feedback.delivery_requested"
  idempotencyKey: string
  payload: Readonly<{
    schemaVersion: 1
    feedbackDeskItemId: string
    reference: string
    kind: string
  }>
}>

export type FeedbackDeskOutboundPayload = Readonly<{
  schemaVersion: 1
  feedbackDeskItemId: string
  reference: string
  kind: string
  status: string
  notificationKind: string | null
}>

export function feedbackDeskOutboundPayload(input: Readonly<{
  id: string
  kind: string
  status: string
  notificationKind: string | null
}>): FeedbackDeskOutboundPayload {
  return {
    schemaVersion: 1,
    feedbackDeskItemId: input.id,
    reference: `CFD-${input.id}`,
    kind: input.kind,
    status: input.status,
    notificationKind: input.notificationKind,
  }
}

export type FeedbackRequesterNotificationEvent = Readonly<{
  eventType: "feedback.requester_notification"
  idempotencyKey: string
  payload: FeedbackDeskOutboundPayload
}>

export function feedbackRequesterNotificationEvent(input: Readonly<{
  id: string
  kind: string
  status: string
  notificationKind: string
  idempotencyKey: string
}>): FeedbackRequesterNotificationEvent {
  return {
    eventType: "feedback.requester_notification",
    idempotencyKey: `feedback-requester-notification:${input.idempotencyKey}`,
    payload: feedbackDeskOutboundPayload(input),
  }
}

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
  route?: FeedbackDeliveryRoute,
): boolean {
  return (route ?? feedbackDeliveryRoute(item)) === "engineering" &&
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
      kind: item.kind,
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
          graphId: input.graphId?.trim() || null,
          implementationTaskId: input.implementationTaskId?.trim() || null,
          reviewTaskId: input.reviewTaskId?.trim() || null,
          releaseTaskId: input.releaseTaskId?.trim() || null,
          error,
        }
      : null
  }

  const graphId = input.graphId?.trim()
  const implementationTaskId = input.implementationTaskId?.trim()
  const reviewTaskId = input.reviewTaskId?.trim()
  const releaseTaskId = input.releaseTaskId?.trim()
  if (
    !graphId ||
    !implementationTaskId ||
    !reviewTaskId ||
    !releaseTaskId
  ) {
    return null
  }
  return {
    status: "created",
    graphId,
    implementationTaskId,
    reviewTaskId,
    releaseTaskId,
    error: null,
  }
}
