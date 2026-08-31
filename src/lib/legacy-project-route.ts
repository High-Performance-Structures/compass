/**
 * Next's route matcher can receive an encoded colon as part of a legacy
 * Buildertrend project ID. Decode only the colon used by that ID format;
 * decoding the whole pathname could turn an encoded slash into a new route
 * segment.
 */
export function decodedLegacyProjectId(projectId: unknown): string | null {
  if (typeof projectId !== "string") return null

  const match = projectId.match(
    /^(buildertrend-lead-project)%3a([a-z0-9._~-]+)%3a([a-z0-9._~-]+)$/i,
  )
  if (!match) return null

  const [, prefix, organizationId, leadId] = match
  return `${prefix}:${organizationId}:${leadId}`
}

export function normalizedLegacyProjectId(projectId: unknown): string | null {
  const candidate = decodedLegacyProjectId(projectId) ?? projectId
  return typeof candidate === "string" &&
    /^buildertrend-lead-project:[a-z0-9._~-]+:[a-z0-9._~-]+$/i.test(candidate)
    ? candidate
    : null
}

export function scalarLegacyRouteSearchParam(
  value: unknown,
): string | undefined {
  return typeof value === "string" ? value : undefined
}

export function isSafeLegacyProjectSuffix(suffix: string | undefined): boolean {
  if (!suffix) return true
  if (!suffix.startsWith("/") || suffix.startsWith("//")) return false

  return suffix
    .slice(1)
    .split("/")
    .every((segment) => {
      // RFC 3986 path-segment characters plus valid percent escapes. Decode
      // once so encoded dot segments and path separators cannot cross the
      // project-route boundary, while IDs such as `sage-pay-app%3A...` remain
      // valid deep links.
      if (
        !segment ||
        !/^(?:[a-z0-9._~!$&'()*+,;=:@-]|%[0-9a-f]{2})+$/i.test(segment)
      ) {
        return false
      }

      let decodedSegment: string
      try {
        decodedSegment = decodeURIComponent(segment)
      } catch {
        return false
      }

      return (
        decodedSegment !== "." &&
        decodedSegment !== ".." &&
        !/[\\/\u0000-\u001f\u007f]/.test(decodedSegment)
      )
    })
}

type LegacyProjectRoute = {
  readonly sourceProjectId: string
  readonly suffix: string
}

export type LegacyProjectDeepLink = {
  readonly suffix: string
  readonly originalSearch: string | undefined
}

export function legacyProjectRouteFromPathname(
  pathname: string,
): LegacyProjectRoute | null {
  const match = pathname.match(
    /^\/dashboard\/projects\/([^/]+)(\/.*)?$/i,
  )
  if (!match) return null

  const [, routeProjectId, suffix = ""] = match
  const sourceProjectId = normalizedLegacyProjectId(routeProjectId)
  return sourceProjectId ? { sourceProjectId, suffix } : null
}

export function legacyProjectDeepLinkFromRequestUrl(
  requestUrl: string | null,
  expectedSourceProjectId: string,
): LegacyProjectDeepLink | null {
  if (!requestUrl) return null

  let parsedUrl: URL
  try {
    parsedUrl = new URL(requestUrl)
  } catch {
    return null
  }

  const route = legacyProjectRouteFromPathname(parsedUrl.pathname)
  const normalizedExpectedId = normalizedLegacyProjectId(expectedSourceProjectId)
  if (!route || !normalizedExpectedId || route.sourceProjectId !== normalizedExpectedId) {
    return null
  }

  const search = originalRouteSearch(parsedUrl.search).toString()
  return {
    suffix: route.suffix,
    originalSearch: search || undefined,
  }
}

function originalRouteSearch(search: string | undefined): URLSearchParams {
  const params = new URLSearchParams(search ?? "")
  params.delete("legacyResolved")
  return params
}

export function legacyProjectResolutionPathname(
  pathname: string,
  originalSearch?: string,
): string | null {
  const route = legacyProjectRouteFromPathname(pathname)
  if (!route) return null

  const search = new URLSearchParams({ sourceProjectId: route.sourceProjectId })
  if (route.suffix) search.set("suffix", route.suffix)
  const preservedSearch = originalRouteSearch(originalSearch).toString()
  if (preservedSearch) search.set("originalSearch", preservedSearch)
  return `/dashboard/projects/legacy-route?${search.toString()}`
}

export function legacyProjectFallbackPathname(
  sourceProjectId: string,
  suffix: string | undefined,
  originalSearch?: string,
): string | null {
  const normalizedProjectId = normalizedLegacyProjectId(sourceProjectId)
  if (!normalizedProjectId) return null

  const safeSuffix =
    isSafeLegacyProjectSuffix(suffix)
      ? (suffix ?? "")
      : "/information"
  const search = originalRouteSearch(originalSearch)
  search.set("legacyResolved", "1")
  // This source ID has already been constrained to route-safe characters.
  // Keep its two structural colons literal because the existing project pages
  // query these retained lead rows by the decoded Compass ID.
  return `/dashboard/projects/${normalizedProjectId}${safeSuffix}?${search.toString()}`
}

export function decodedLegacyProjectPathname(pathname: string): string | null {
  const match = pathname.match(
    /^\/dashboard\/projects\/([^/]+)(\/.*)?$/i,
  )
  if (!match) return null

  const [, encodedProjectId, suffix = ""] = match
  const projectId = decodedLegacyProjectId(encodedProjectId)
  if (!projectId) return null

  return `/dashboard/projects/${projectId}${suffix}`
}
