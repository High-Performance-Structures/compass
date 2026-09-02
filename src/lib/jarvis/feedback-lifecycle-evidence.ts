type FeedbackLifecycleEvidenceItem = Readonly<{
  kind: string
  status: string
  deliveryGraphId: string | null
  deliveryGraphStatus: string | null
  deliveryGraphImplementationTaskId: string | null
  deliveryGraphReviewTaskId: string | null
  deliveryGraphReleaseTaskId: string | null
  githubDraftPullRequestUrl: string | null
}>

type FeedbackBugTransition = FeedbackLifecycleEvidenceItem & Readonly<{
  nextStatus: string
}>

type FeedbackEngineeringTransition = FeedbackBugTransition & Readonly<{
  deliveryRoute: "engineering" | "response" | "feature_decision"
}>

function present(value: string | null): boolean {
  return value !== null && value.trim().length > 0
}

export function feedbackDeliveryGraphIsComplete(
  item: Pick<
    FeedbackLifecycleEvidenceItem,
    | "deliveryGraphId"
    | "deliveryGraphStatus"
    | "deliveryGraphImplementationTaskId"
    | "deliveryGraphReviewTaskId"
    | "deliveryGraphReleaseTaskId"
  >,
): boolean {
  return (
    item.deliveryGraphStatus === "created" &&
    present(item.deliveryGraphId) &&
    present(item.deliveryGraphImplementationTaskId) &&
    present(item.deliveryGraphReviewTaskId) &&
    present(item.deliveryGraphReleaseTaskId)
  )
}

export function feedbackEngineeringTransitionIsBlocked(
  transition: FeedbackEngineeringTransition,
): string | null {
  if (
    transition.kind === "feature" ||
    transition.deliveryRoute !== "engineering" ||
    transition.status === transition.nextStatus
  ) {
    return null
  }

  const subject = transition.kind === "bug" ? "A bug" : "An engineering request"

  if (transition.nextStatus === "planned") {
    return feedbackDeliveryGraphIsComplete(transition)
      ? null
      : `${subject} must have a complete durable delivery graph before it is planned`
  }

  if (transition.nextStatus === "in_progress") {
    return feedbackDeliveryGraphIsComplete(transition)
      ? null
      : `${subject} must have a complete durable delivery graph before implementation starts`
  }

  if (transition.nextStatus === "testing") {
    return feedbackDeliveryGraphIsComplete(transition) &&
      present(transition.githubDraftPullRequestUrl)
      ? null
      : `${subject} must have a pull request and complete durable review evidence before testing`
  }

  if (transition.nextStatus === "deployed") {
    return feedbackDeliveryGraphIsComplete(transition) &&
      present(transition.githubDraftPullRequestUrl)
      ? null
      : `${subject} must have a pull request and complete durable release evidence before deployment`
  }

  return null
}

export function feedbackBugTransitionIsBlocked(
  transition: FeedbackBugTransition,
): string | null {
  return feedbackEngineeringTransitionIsBlocked({
    ...transition,
    deliveryRoute: "engineering",
  })
}
