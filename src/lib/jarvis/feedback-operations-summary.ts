export type FeedbackOperationsSummaryItem = Readonly<{
  assignedToUserId: string | null
  kind: string
  overdue: boolean
  status: string
}>

export type FeedbackOperationsSummaryInput = Readonly<{
  bridgeFailedEvents: number
  items: readonly FeedbackOperationsSummaryItem[]
}>

export type FeedbackOperationsSummary = Readonly<{
  attentionMessage: string
  failedBridgeEvents: number
  featureDecisionMessage: string
  featureDecisionRequests: number
  needsAttention: boolean
  openBugs: number
  openFeatures: number
  overdue: number
  unassigned: number
}>

const FEATURE_DECISION_STATUSES = new Set(["new", "triaged", "needs_info"])

function isOpenFeedbackStatus(status: string): boolean {
  return status !== "closed" && status !== "deployed"
}

function isFeatureDecisionPending(item: FeedbackOperationsSummaryItem): boolean {
  return item.kind === "feature" && FEATURE_DECISION_STATUSES.has(item.status)
}

function requestLabel(count: number): string {
  return `${count} request${count === 1 ? "" : "s"}`
}

export function feedbackOperationsSummary(
  input: FeedbackOperationsSummaryInput,
): FeedbackOperationsSummary {
  const openItems = input.items.filter((item) => isOpenFeedbackStatus(item.status))
  const overdue = openItems.filter((item) => item.overdue).length
  const unassigned = openItems.filter((item) => !item.assignedToUserId).length
  const openBugs = openItems.filter((item) => item.kind === "bug").length
  const openFeatures = openItems.filter((item) => item.kind === "feature").length
  const featureDecisionRequests = openItems.filter(isFeatureDecisionPending).length
  const attentionParts = [
    overdue > 0 ? `${requestLabel(overdue)} overdue` : null,
    unassigned > 0 ? `${requestLabel(unassigned)} unassigned` : null,
    featureDecisionRequests > 0
      ? `${requestLabel(featureDecisionRequests)} awaiting leadership review`
      : null,
    input.bridgeFailedEvents > 0
      ? `${input.bridgeFailedEvents} failed bridge event${input.bridgeFailedEvents === 1 ? "" : "s"}`
      : null,
  ].filter((value): value is string => value !== null)

  return {
    attentionMessage: attentionParts.length > 0
      ? `${attentionParts.join(" · ")}. Review the protected queue below.`
      : "No current operational escalation requires attention.",
    failedBridgeEvents: input.bridgeFailedEvents,
    featureDecisionMessage: featureDecisionRequests > 0
      ? `${requestLabel(featureDecisionRequests)} await${featureDecisionRequests === 1 ? "s" : ""} leadership priority review before implementation.`
      : "No feature requests currently await leadership priority review.",
    featureDecisionRequests,
    needsAttention: attentionParts.length > 0,
    openBugs,
    openFeatures,
    overdue,
    unassigned,
  }
}
