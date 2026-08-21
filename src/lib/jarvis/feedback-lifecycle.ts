export const FEEDBACK_DESK_STATUSES = [
  "new",
  "triaged",
  "needs_info",
  "planned",
  "in_progress",
  "testing",
  "deployed",
  "closed",
] as const

export type FeedbackDeskStatus =
  (typeof FEEDBACK_DESK_STATUSES)[number]

export const FEEDBACK_PRIORITIES = ["low", "normal", "high", "urgent"] as const
export type FeedbackPriority = (typeof FEEDBACK_PRIORITIES)[number]

export function knownFeedbackStatus(value: string): FeedbackDeskStatus {
  return FEEDBACK_DESK_STATUSES.find((status) => status === value) ?? "new"
}

export function knownFeedbackPriority(value: string): FeedbackPriority {
  return FEEDBACK_PRIORITIES.find((priority) => priority === value) ?? "normal"
}

export type FeedbackStaffStage =
  | "submitted"
  | "triaged"
  | "in_process"
  | "implemented"

export type FeedbackRequesterUpdateKind =
  | "status_changed"
  | "draft_pull_request_opened"
  | "draft_pull_request_updated"
  | "delivery_graph_created"
  | "delivery_graph_failed"

export function feedbackRequesterUpdateKind(
  previousStatus: string,
  nextStatus: string,
  previousDraftPullRequestUrl: string | null,
  nextDraftPullRequestUrl: string | null,
  deliveryGraphStatus: "created" | "failed" | null = null,
): FeedbackRequesterUpdateKind | null {
  if (deliveryGraphStatus === "created") return "delivery_graph_created"
  if (deliveryGraphStatus === "failed") return "delivery_graph_failed"
  if (
    nextDraftPullRequestUrl !== null &&
    nextDraftPullRequestUrl !== previousDraftPullRequestUrl
  ) {
    return previousDraftPullRequestUrl === null
      ? "draft_pull_request_opened"
      : "draft_pull_request_updated"
  }
  return previousStatus === nextStatus ? null : "status_changed"
}

export function feedbackStatusLabel(status: string): string {
  switch (status) {
    case "new":
      return "New"
    case "triaged":
      return "Triaged"
    case "needs_info":
      return "Information needed"
    case "planned":
      return "Planned"
    case "in_progress":
      return "In progress"
    case "testing":
      return "Ready for testing"
    case "deployed":
      return "Deployed"
    case "closed":
      return "Closed"
    default:
      return status
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase())
  }
}

export function feedbackStaffStage(status: string): FeedbackStaffStage {
  switch (status) {
    case "new":
      return "submitted"
    case "triaged":
    case "needs_info":
    case "planned":
      return "triaged"
    case "in_progress":
    case "testing":
      return "in_process"
    case "deployed":
    case "closed":
      return "implemented"
    default:
      return "submitted"
  }
}

export function feedbackStatusMessage(
  status: FeedbackDeskStatus,
  title: string,
  kind = "bug",
): string {
  if (kind !== "bug" && status === "closed") {
    return "The Feedback Desk reviewed this request and provided an accountable response. No Compass code change was required."
  }
  switch (status) {
    case "new":
      return `Your request “${title}” has been received.`
    case "triaged":
      return `Your request “${title}” has been reviewed and triaged.`
    case "needs_info":
      return `Jarvis needs more information about “${title}” before work can continue.`
    case "planned":
      return `Your request “${title}” has been accepted and planned.`
    case "in_progress":
      return `Development has started on “${title}”.`
    case "testing":
      return `“${title}” is ready for testing.`
    case "deployed":
      return `“${title}” has been deployed to Compass.`
    case "closed":
      return `Your request “${title}” has been completed and closed.`
  }
}

export function feedbackNonEngineeringTransitionIsBlocked(
  transition: Readonly<{
    kind: string
    status: string
    nextStatus: string
    deliveryRoute: "engineering" | "response" | "feature_decision"
  }>,
): string | null {
  if (transition.kind === "feature" || transition.deliveryRoute !== "response") {
    return null
  }
  if (["planned", "in_progress", "testing", "deployed"].includes(transition.nextStatus)) {
    return "A response-only request cannot enter an engineering lifecycle"
  }
  return null
}

export function feedbackDraftPullRequestMessage(
  title: string,
  draftPullRequestUrl: string,
): string {
  return `A draft pull request for “${title}” is available for review: ${draftPullRequestUrl}`
}

export function feedbackStatusUsesEmail(
  status: FeedbackDeskStatus
): boolean {
  return (
    status === "needs_info" ||
    status === "testing" ||
    status === "deployed"
  )
}

const SLA_HOURS_BY_PRIORITY = {
  low: 168,
  normal: 72,
  high: 24,
  urgent: 4,
} as const

export function feedbackSlaTarget(
  priority: string,
  from = new Date(),
): string {
  const hours =
    priority === "urgent" ||
    priority === "high" ||
    priority === "normal" ||
    priority === "low"
      ? SLA_HOURS_BY_PRIORITY[priority]
      : SLA_HOURS_BY_PRIORITY.normal
  return new Date(from.getTime() + hours * 60 * 60 * 1_000).toISOString()
}

export function feedbackIsResolved(status: string): boolean {
  return status === "deployed" || status === "closed"
}

export function feedbackIsOverdue(
  status: string,
  slaTargetAt: string | null,
  now = new Date(),
): boolean {
  return (
    !feedbackIsResolved(status) &&
    slaTargetAt !== null &&
    new Date(slaTargetAt).getTime() < now.getTime()
  )
}
