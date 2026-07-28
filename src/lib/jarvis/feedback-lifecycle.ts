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

export type FeedbackRequesterUpdateKind =
  | "status_changed"
  | "draft_pull_request_opened"
  | "draft_pull_request_updated"

export function feedbackRequesterUpdateKind(
  previousStatus: string,
  nextStatus: string,
  previousDraftPullRequestUrl: string | null,
  nextDraftPullRequestUrl: string | null,
): FeedbackRequesterUpdateKind | null {
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

export function feedbackStatusMessage(
  status: FeedbackDeskStatus,
  title: string
): string {
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
