export type FeedbackFeaturePriorityTransition = Readonly<{
  currentStatus: string
  kind: string
  nextStatus: string
}>

const FEATURE_IMPLEMENTATION_STATUSES = new Set([
  "planned",
  "in_progress",
  "testing",
  "deployed",
])

export function isFeatureImplementationStatus(status: string): boolean {
  return FEATURE_IMPLEMENTATION_STATUSES.has(status)
}

export function feedbackFeatureTransitionRequiresPriorityApproval(
  transition: FeedbackFeaturePriorityTransition,
): boolean {
  return (
    transition.kind === "feature" &&
    !isFeatureImplementationStatus(transition.currentStatus) &&
    isFeatureImplementationStatus(transition.nextStatus)
  )
}

export function feedbackFeatureGithubIssueCreationIsBlocked(
  item: Readonly<{
    kind: string
    featurePriorityApprovedAt: string | null
  }>,
): boolean {
  return item.kind === "feature" && item.featurePriorityApprovedAt === null
}

export function feedbackFeatureGithubIssueApprovalIsStale(
  item: Readonly<{
    kind: string
    featurePriorityApprovedAt: string | null
    githubIssueCreationApprovedAt: string | null
  }>,
): boolean {
  return (
    item.kind === "feature" &&
    item.featurePriorityApprovedAt === null &&
    item.githubIssueCreationApprovedAt !== null
  )
}

export function feedbackFeatureTransitionIsBlocked(
  transition: FeedbackFeaturePriorityTransition & Readonly<{
    featurePriorityApprovedAt: string | null
  }>,
): boolean {
  return (
    transition.kind === "feature" &&
    transition.featurePriorityApprovedAt === null &&
    isFeatureImplementationStatus(transition.nextStatus)
  )
}
