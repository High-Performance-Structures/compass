export type FeedbackDeskQueueItem = Readonly<{
  assignedToUserId: string | null
  githubIssueCreationApprovedAt: string | null
  githubIssueUrl: string | null
  id: string
  kind: string
  overdue: boolean
  status: string
  title: string
}>

export const FEEDBACK_DESK_QUEUE_VIEW_IDS = [
  "attention",
  "bugs",
  "feature_decisions",
  "active",
  "resolved",
  "all",
] as const

export type FeedbackDeskQueueViewId =
  (typeof FEEDBACK_DESK_QUEUE_VIEW_IDS)[number]

export type FeedbackDeskQueueGithubFilter = "all" | "linked" | "review" | "approved"

const FEEDBACK_DESK_QUEUE_GITHUB_FILTERS = [
  "all",
  "linked",
  "review",
  "approved",
] as const

export type FeedbackDeskQueueFilters = Readonly<{
  github: FeedbackDeskQueueGithubFilter
  kind: string
  query: string
  status: string
  view: FeedbackDeskQueueViewId
}>

export type FeedbackDeskQueueView = Readonly<{
  count: number
  id: FeedbackDeskQueueViewId
  label: string
}>

export function knownFeedbackDeskQueueViewId(value: string): FeedbackDeskQueueViewId {
  return FEEDBACK_DESK_QUEUE_VIEW_IDS.find((view) => view === value) ?? "attention"
}

export function knownFeedbackDeskQueueGithubFilter(
  value: string,
): FeedbackDeskQueueGithubFilter {
  return FEEDBACK_DESK_QUEUE_GITHUB_FILTERS.find((filter) => filter === value) ?? "all"
}

const FEATURE_DECISION_STATUSES = new Set(["new", "triaged", "needs_info"])

function isResolved(item: FeedbackDeskQueueItem): boolean {
  return item.status === "closed" || item.status === "deployed"
}

function needsFeatureDecision(item: FeedbackDeskQueueItem): boolean {
  return item.kind === "feature" && FEATURE_DECISION_STATUSES.has(item.status)
}

function needsAttention(item: FeedbackDeskQueueItem): boolean {
  return item.overdue || !item.assignedToUserId || needsFeatureDecision(item)
}

function matchesView(
  item: FeedbackDeskQueueItem,
  view: FeedbackDeskQueueViewId,
): boolean {
  switch (view) {
    case "attention":
      return !isResolved(item) && needsAttention(item)
    case "bugs":
      return !isResolved(item) && item.kind === "bug"
    case "feature_decisions":
      return needsFeatureDecision(item)
    case "active":
      return !isResolved(item)
    case "resolved":
      return isResolved(item)
    case "all":
      return true
  }
}

function matchesGithub(
  item: FeedbackDeskQueueItem,
  github: FeedbackDeskQueueGithubFilter,
): boolean {
  switch (github) {
    case "linked":
      return item.githubIssueUrl !== null
    case "review":
      return item.githubIssueUrl === null && item.githubIssueCreationApprovedAt === null
    case "approved":
      return item.githubIssueUrl === null && item.githubIssueCreationApprovedAt !== null
    case "all":
      return true
  }
}

export function feedbackDeskQueueViews(
  items: readonly FeedbackDeskQueueItem[],
): readonly FeedbackDeskQueueView[] {
  return [
    { id: "attention", label: "Needs attention", count: items.filter((item) => matchesView(item, "attention")).length },
    { id: "bugs", label: "Bug workflow", count: items.filter((item) => matchesView(item, "bugs")).length },
    { id: "feature_decisions", label: "Feature decisions", count: items.filter((item) => matchesView(item, "feature_decisions")).length },
    { id: "active", label: "Active requests", count: items.filter((item) => matchesView(item, "active")).length },
    { id: "resolved", label: "Resolved requests", count: items.filter((item) => matchesView(item, "resolved")).length },
    { id: "all", label: "All requests", count: items.length },
  ]
}

export function feedbackDeskQueueItems<T extends FeedbackDeskQueueItem>(
  items: readonly T[],
  filters: FeedbackDeskQueueFilters,
): readonly T[] {
  const query = filters.query.trim().toLowerCase()
  return items.filter((item) =>
    matchesView(item, filters.view) &&
    matchesGithub(item, filters.github) &&
    (filters.kind === "all" || item.kind === filters.kind) &&
    (filters.status === "all" || item.status === filters.status) &&
    (query.length === 0 || item.title.toLowerCase().includes(query)),
  )
}
