import type { ProjectAudience } from "@/lib/project-audience-access"

export const AUDIENCE_SCOPE_HEADER = "x-compass-audience-scope"

export type ProjectAudienceRequestScope = {
  readonly projectId: string
  readonly audience: ProjectAudience
  readonly targetUserId: string | null
}

export function audienceScopeFromUrl(url: URL): ProjectAudienceRequestScope | null {
  const match = /^\/preview\/projects\/([^/]+)\/(owner|sub-vendor)(?:\/|$)/.exec(url.pathname)
  if (match) {
    return {
      projectId: decodeURIComponent(match[1]),
      audience: match[2] === "owner" ? "owner" : "sub_vendor",
      targetUserId: url.searchParams.get("previewAs") || null,
    }
  }
  // Downloads are new requests, so their links carry the same explicit scope.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/print/")) {
    const projectId = url.searchParams.get("previewProject")
    const audience = url.searchParams.get("previewAudience")
    if (projectId && (audience === "owner" || audience === "sub_vendor")) {
      const routeProject = /^\/api\/projects\/([^/]+)(?:\/|$)/.exec(url.pathname)
      const queryProject = url.searchParams.get("projectId")
      if ((routeProject && decodeURIComponent(routeProject[1]) !== projectId) || (queryProject && queryProject !== projectId)) throw new Error("Preview scope does not match this file.")
      return { projectId, audience, targetUserId: url.searchParams.get("previewAs") || null }
    }
  }
  return null
}

export function parseAudienceScope(value: string | null): ProjectAudienceRequestScope | null {
  if (!value) return null
  const parsed: unknown = JSON.parse(value)
  if (typeof parsed !== "object" || parsed === null ||
      !("projectId" in parsed) || typeof parsed.projectId !== "string" ||
      !("audience" in parsed) || (parsed.audience !== "owner" && parsed.audience !== "sub_vendor") ||
      !("targetUserId" in parsed) || (parsed.targetUserId !== null && typeof parsed.targetUserId !== "string")) {
    throw new Error("Invalid preview scope.")
  }
  return { projectId: parsed.projectId, audience: parsed.audience, targetUserId: parsed.targetUserId }
}

export function scopedAudienceHref(href: string, scope: ProjectAudienceRequestScope): string {
  const url = new URL(href, "https://compass.invalid")
  if (url.origin !== "https://compass.invalid") return href
  if (url.pathname.startsWith("/preview/projects/")) {
    const nextScope = audienceScopeFromUrl(url)
    if (!nextScope || nextScope.projectId !== scope.projectId || nextScope.audience !== scope.audience) return href
  } else if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/print/")) {
    url.searchParams.set("previewProject", scope.projectId)
    url.searchParams.set("previewAudience", scope.audience)
  } else return href
  if (scope.targetUserId) url.searchParams.set("previewAs", scope.targetUserId)
  else url.searchParams.delete("previewAs")
  return `${url.pathname}${url.search}${url.hash}`
}
