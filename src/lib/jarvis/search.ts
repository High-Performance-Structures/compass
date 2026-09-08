import { isInternalStaffRole } from "@/lib/user-roles"
import { dateKeyInTimeZone, isValidDateKey } from "@/lib/work-calendar"

export type JarvisCompassSearchKind =
  | "project"
  | "daily_log"
  | "owner_update"
  | "rfi"
  | "estimate"
  | "calendar_event"
  | "feedback_request"

export type JarvisCompassSearchResult = {
  readonly kind: JarvisCompassSearchKind
  readonly title: string
  readonly summary: string
  readonly projectName: string
  readonly projectNumber: string | null
  readonly date: string
  readonly status: string | null
  readonly href: string
  readonly verified: boolean
  readonly lifecycleStage: string | null
}

export type JarvisSearchProject = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
  readonly clientName: string | null
}

const GENERIC_SEARCH_WORDS: readonly string[] = [
  "about",
  "anything",
  "any",
  "active",
  "all",
  "calendar",
  "can",
  "capabilities",
  "changed",
  "compass",
  "could",
  "customer",
  "customers",
  "client",
  "clients",
  "find",
  "for",
  "from",
  "give",
  "have",
  "latest",
  "list",
  "link",
  "links",
  "location",
  "locations",
  "looked",
  "now",
  "please",
  "project",
  "proposal",
  "proposals",
  "progress",
  "provide",
  "report",
  "reported",
  "request",
  "requests",
  "search",
  "show",
  "since",
  "status",
  "today",
  "submission",
  "submitted",
  "some",
  "tell",
  "that",
  "the",
  "think",
  "this",
  "through",
  "update",
  "updates",
  "what",
  "when",
  "where",
  "with",
  "you",
  "your",
  "bug",
  "deployed",
  "feature",
  "feedback",
  "implemented",
  "estimate",
  "estimates",
  "event",
  "events",
  "meeting",
  "meetings",
  "triaged",
]

function normalized(value: string): string {
  return value.trim().toLowerCase()
}

export function canSearchCompassRole(role: string): boolean {
  return isInternalStaffRole(normalized(role))
}

export function currentProjectIdFromPath(path: string): string | null {
  const match = path.match(/^\/dashboard\/projects\/([^/?#]+)/)
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

export function jarvisSearchTerms(query: string): readonly string[] {
  const genericWords = new Set(GENERIC_SEARCH_WORDS)
  return Array.from(
    new Set(
      normalized(query)
        .split(/[^a-z0-9-]+/)
        .filter((term) => term.length >= 3 && !genericWords.has(term))
    )
  ).slice(0, 12)
}

function projectSearchText(project: JarvisSearchProject): string {
  return normalized(
    [
      project.name,
      project.projectNumber ?? "",
      project.clientName ?? "",
    ].join(" ")
  )
}

function projectScore(
  project: JarvisSearchProject,
  query: string,
  terms: readonly string[]
): number {
  const projectText = projectSearchText(project)
  const name = normalized(project.name)
  const number = normalized(project.projectNumber ?? "")
  const normalizedQuery = normalized(query)
  let score = 0

  if (name.length >= 3 && normalizedQuery.includes(name)) score += 100
  if (number.length >= 2 && normalizedQuery.includes(number)) score += 100
  for (const term of terms) {
    if (projectText.includes(term)) score += 10
  }
  return score
}

export function projectIdsForJarvisSearch(
  projects: readonly JarvisSearchProject[],
  query: string,
  currentProjectId: string | null
): readonly string[] {
  const terms = jarvisSearchTerms(query)
  const scored = projects
    .map((project) => ({
      id: project.id,
      score: projectScore(project, query, terms),
    }))
    .filter((project) => project.score > 0)
    .sort((left, right) => right.score - left.score)

  if (scored.length > 0) {
    return scored.slice(0, 3).map((project) => project.id)
  }

  if (
    currentProjectId &&
    projects.some((project) => project.id === currentProjectId)
  ) {
    return [currentProjectId]
  }

  return projects.map((project) => project.id)
}

export function projectIdsForJarvisCalendarSearch(
  projects: readonly JarvisSearchProject[],
  query: string,
  currentProjectId: string | null,
): readonly string[] {
  const terms = jarvisSearchTerms(query)
  const scored = projects
    .map((project) => ({
      id: project.id,
      score: projectScore(project, query, terms),
    }))
    .filter((project) => project.score > 0)
    .sort((left, right) => right.score - left.score)

  if (scored.length > 0) {
    return scored.slice(0, 3).map((project) => project.id)
  }

  if (
    /\b(?:this|current)\s+project\b/.test(normalized(query)) &&
    currentProjectId &&
    projects.some((project) => project.id === currentProjectId)
  ) {
    return [currentProjectId]
  }

  return projects.map((project) => project.id)
}

export function isProjectScopedJarvisCalendarSearch(
  projects: readonly JarvisSearchProject[],
  query: string,
  currentProjectId: string | null,
): boolean {
  const terms = jarvisSearchTerms(query)
  const namesProject = projects.some(
    (project) => projectScore(project, query, terms) > 0,
  )
  if (namesProject) return true

  return Boolean(
    /\b(?:this|current)\s+project\b/.test(normalized(query)) &&
      currentProjectId &&
      projects.some((project) => project.id === currentProjectId),
  )
}

export function projectIdsForJarvisProjectSearch(
  projects: readonly JarvisSearchProject[],
  query: string,
  currentProjectId: string | null,
): readonly string[] {
  const terms = jarvisSearchTerms(query)
  const scored = projects
    .map((project) => ({
      id: project.id,
      score: projectScore(project, query, terms),
    }))
    .filter((project) => project.score > 0)
    .sort((left, right) => right.score - left.score)

  if (scored.length > 0) {
    return scored.slice(0, 3).map((project) => project.id)
  }

  if (
    /\b(?:this|current)\s+project\b/.test(normalized(query)) &&
    currentProjectId &&
    projects.some((project) => project.id === currentProjectId)
  ) {
    return [currentProjectId]
  }

  return projects.map((project) => project.id)
}

export function requestedJarvisSearchKinds(
  query: string
): readonly JarvisCompassSearchKind[] {
  const value = normalized(query)
  if (
    /\b(feedback|requests?|submissions?|reports?|bugs?|features?)\b/.test(
      value
    ) &&
    /\b(status|progress|triag|implement|deploy|verify|received|submitted)\w*\b/.test(
      value,
    )
  ) {
    return ["feedback_request"]
  }
  if (
    /\b(calendar|agenda|appointments?|meetings?|events?)\b/.test(value)
  ) {
    return ["calendar_event"]
  }
  if (/\b(estimates?|proposals?)\b/.test(value)) return ["estimate"]
  if (/\brfis?\b/.test(value)) return ["rfi"]
  if (value.includes("owner update")) return ["owner_update"]
  if (value.includes("daily log")) return ["daily_log"]
  if (/\bprojects?|portfolio\b/.test(value)) return ["project"]
  return ["daily_log", "owner_update", "rfi"]
}

function isJarvisSearchRetry(query: string): boolean {
  const value = normalized(query).replace(/[.!?]+$/, "")
  return /^(?:please\s+)?(?:check|look|try)(?:\s+(?:it|that))?\s+again(?:\s+please)?$/.test(
    value
  )
}

export function jarvisSearchQueryForConversation(
  userMessages: readonly string[]
): string {
  const latest = userMessages.at(-1)?.trim() ?? ""
  if (!isJarvisSearchRetry(latest)) return latest

  const previous = userMessages.at(-2)?.trim() ?? ""
  return previous.length > 0 ? previous : latest
}

export function requestedProjectStatus(query: string): string | null {
  const value = normalized(query)
  if (!/\bprojects?|portfolio\b/.test(value)) return null
  if (/\b(active|open|current)\b/.test(value)) return "active"
  if (/\bwarranty\b/.test(value)) return "warranty"
  if (/\b(complete|completed|closed|finished)\b/.test(value)) return "complete"
  if (/\binactive\b/.test(value)) return "inactive"
  if (/\barchiv(?:e|ed)\b/.test(value)) return "archive"
  return null
}

export function requestedCalendarDate(
  query: string,
  timeZone: string,
  now = new Date(),
): string | null {
  const value = normalized(query)
  const today = dateKeyInTimeZone(now, timeZone)
  const explicitDate = value.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] ?? null
  if (explicitDate) return isValidDateKey(explicitDate) ? explicitDate : null

  const dayOffset = /\btomorrow\b/.test(value)
    ? 1
    : /\byesterday\b/.test(value)
      ? -1
      : 0
  if (dayOffset === 0) {
    const unsupportedDateReference =
      /\b(?:next|last|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|week|month|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/.test(
        value,
      )
    return unsupportedDateReference ? null : today
  }

  const anchor = new Date(`${today}T12:00:00Z`)
  anchor.setUTCDate(anchor.getUTCDate() + dayOffset)
  return anchor.toISOString().slice(0, 10)
}

export function projectHref(projectId: string): string {
  return `/dashboard/projects/${encodeURIComponent(projectId)}`
}

export function projectSectionHref(
  projectId: string,
  section: "daily-logs" | "owner-updates" | "rfis"
): string {
  return `${projectHref(projectId)}/${section}`
}

export function ownerUpdateHref(
  projectId: string,
  updateId: string
): string {
  return `${projectSectionHref(projectId, "owner-updates")}/${encodeURIComponent(
    updateId
  )}`
}

export function dailyLogHref(projectId: string, dailyLogId: string): string {
  return `${projectSectionHref(projectId, "daily-logs")}#daily-log-${encodeURIComponent(
    dailyLogId
  )}`
}

export function rfiHref(projectId: string, rfiId: string): string {
  return `${projectSectionHref(projectId, "rfis")}?status=all#rfi-${encodeURIComponent(
    rfiId
  )}`
}

export function feedbackRequestHref(requestId: string): string {
  return `/dashboard/requests/${encodeURIComponent(requestId)}`
}

export function estimateHref(
  projectId: string,
  estimateId: string,
): string {
  return `${projectHref(projectId)}/estimate?estimateId=${encodeURIComponent(
    estimateId,
  )}`
}

export function calendarEventHref(eventId: string): string {
  const encodedId = encodeURIComponent(eventId)
  return `/dashboard/schedule?kind=event&item=${encodedId}#work-calendar-${encodedId}`
}
