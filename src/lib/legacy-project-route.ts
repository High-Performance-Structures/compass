/**
 * Next's route matcher can receive an encoded colon as part of a legacy
 * Buildertrend project ID. Decode only the colon used by that ID format;
 * decoding the whole pathname could turn an encoded slash into a new route
 * segment.
 */
export function decodedLegacyProjectId(projectId: string): string | null {
  const match = projectId.match(
    /^(buildertrend-lead-project)%3a([^/%]+)%3a(lead-[0-9]+)$/i,
  )
  if (!match) return null

  const [, prefix, organizationId, leadId] = match
  return `${prefix}:${organizationId}:${leadId}`
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
