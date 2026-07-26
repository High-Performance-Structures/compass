export type JarvisCompassSearchKind =
  | "project"
  | "daily_log"
  | "owner_update"
  | "rfi"

export type JarvisSearchProject = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
  readonly clientName: string | null
}

const SEARCHABLE_ROLES: readonly string[] = ["admin", "office", "field"]

const GENERIC_SEARCH_WORDS: readonly string[] = [
  "about",
  "compass",
  "could",
  "find",
  "for",
  "from",
  "give",
  "latest",
  "please",
  "project",
  "search",
  "show",
  "tell",
  "that",
  "this",
  "update",
  "updates",
  "what",
  "when",
  "where",
  "with",
]

function normalized(value: string): string {
  return value.trim().toLowerCase()
}

export function canSearchCompassRole(role: string): boolean {
  return SEARCHABLE_ROLES.includes(normalized(role))
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

  return projects.slice(0, 12).map((project) => project.id)
}

export function requestedJarvisSearchKinds(
  query: string
): readonly JarvisCompassSearchKind[] {
  const value = normalized(query)
  if (/\brfis?\b/.test(value)) return ["rfi"]
  if (value.includes("owner update")) return ["owner_update"]
  if (value.includes("daily log")) return ["daily_log"]
  return ["daily_log", "owner_update", "rfi"]
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
