export type WorkCalendarProjectIdentity = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
}

export type WorkCalendarSearchableEntry = {
  readonly projectLabel: string
  readonly projectName: string
  readonly title: string
  readonly status: string
  readonly priority: string
  readonly assignedTo: string | null
  readonly companyName: string | null
  readonly sourceLabel: string
}

export function normalizeWorkCalendarSearch(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function workCalendarEntryMatches(
  entry: WorkCalendarSearchableEntry,
  query: string
): boolean {
  const normalizedQuery = normalizeWorkCalendarSearch(query)
  if (!normalizedQuery) return true

  const haystack = normalizeWorkCalendarSearch(
    [
      entry.projectLabel,
      entry.projectName,
      entry.title,
      entry.status,
      entry.priority,
      entry.assignedTo,
      entry.companyName,
      entry.sourceLabel,
    ]
      .filter((value): value is string => Boolean(value))
      .join(" ")
  )

  return haystack.includes(normalizedQuery)
}

export function resolveHOfficeProjectId(
  projects: readonly WorkCalendarProjectIdentity[]
): string | null {
  const matches = projects.filter((project) => {
    const names = [project.name, project.projectNumber]
      .filter((value): value is string => Boolean(value))
      .map(normalizeWorkCalendarSearch)

    return names.some(
      (value) => value === "h office" || value === "h office project"
    )
  })

  return matches.length === 1 ? matches[0]?.id ?? null : null
}

export function scheduleItemHref(projectId: string, itemId: string): string {
  return `/dashboard/projects/${encodeURIComponent(projectId)}/schedule?view=list&item=${encodeURIComponent(itemId)}#schedule-item-${encodeURIComponent(itemId)}`
}

export function projectTodoHref(projectId: string, itemId: string): string {
  return `/dashboard/projects/${encodeURIComponent(projectId)}/todos?item=${encodeURIComponent(itemId)}#todo-${encodeURIComponent(itemId)}`
}
