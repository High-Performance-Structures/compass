const COMPASS_ORIGIN = "https://compass.local"

function projectBaseHref(projectId: string): string {
  return `/dashboard/projects/${encodeURIComponent(projectId)}`
}

function isSafeProjectReturnHref(
  href: string,
  projectId: string,
): boolean {
  if (!href.startsWith("/")) return false

  const parsed = new URL(href, COMPASS_ORIGIN)
  if (parsed.origin !== COMPASS_ORIGIN) return false

  const projectHref = projectBaseHref(projectId)
  const conversationsHref = `${projectHref}/conversations`
  const belongsToProject =
    parsed.pathname === projectHref ||
    parsed.pathname.startsWith(`${projectHref}/`)

  return belongsToProject && parsed.pathname !== conversationsHref
}

export function getProjectConversationReturnHref(
  projectId: string,
  requestedHref: string | null,
): string {
  if (
    requestedHref &&
    isSafeProjectReturnHref(requestedHref, projectId)
  ) {
    return requestedHref
  }

  return projectBaseHref(projectId)
}

export function getProjectConversationsHref(
  projectId: string,
  returnHref: string | null,
): string {
  const href = `${projectBaseHref(projectId)}/conversations`
  const searchParams = new URLSearchParams({
    returnTo: getProjectConversationReturnHref(projectId, returnHref),
  })

  return `${href}?${searchParams.toString()}`
}

export function withProjectConversationContext(
  href: string,
  projectId: string,
  returnHref: string | null,
): string {
  const parsed = new URL(href, COMPASS_ORIGIN)
  parsed.searchParams.set("projectId", projectId)
  parsed.searchParams.set(
    "returnTo",
    getProjectConversationReturnHref(projectId, returnHref),
  )

  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}

export function getConversationBackHref(
  projectId: string | null,
  returnHref: string | null,
): string {
  return projectId
    ? getProjectConversationReturnHref(projectId, returnHref)
    : "/dashboard"
}
