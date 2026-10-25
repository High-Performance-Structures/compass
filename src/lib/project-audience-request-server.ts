import { cache } from "react"
import { resolveProjectRouteId } from "@/lib/project-route-id"
import { headers } from "next/headers"
import { requireAuth } from "@/lib/auth"
import { AUDIENCE_SCOPE_HEADER, parseAudienceScope, type ProjectAudienceRequestScope } from "@/lib/project-audience-request"

export const getProjectAudienceRequestScope = cache(async function getProjectAudienceRequestScope(): Promise<ProjectAudienceRequestScope | null> {
  const scope = parseAudienceScope((await headers()).get(AUDIENCE_SCOPE_HEADER))
  if (!scope) return null
  const projectId = await resolveProjectRouteId(scope.projectId)
  if (!projectId) throw new Error("Project not found.")
  return { ...scope, projectId }
})

export async function isAudiencePreviewRequest(): Promise<boolean> {
  const scope = await getProjectAudienceRequestScope()
  if (!scope) return false
  const { resolveProjectAudienceViewer } = await import("@/lib/project-audience-viewer")
  return (await resolveProjectAudienceViewer(scope.projectId, scope.audience)).isPreview
}

export async function assertAudiencePreviewWriteAllowed(): Promise<void> {
  const scope = await getProjectAudienceRequestScope()
  if (!scope) return
  // Active-shell roles may belong to another organization. Use the same
  // project-organization classification as the reader, including for writes.
  const { resolveProjectAudienceViewer } = await import("@/lib/project-audience-viewer")
  const context = await resolveProjectAudienceViewer(scope.projectId, scope.audience)
  if (context.isPreview) throw new Error("Preview is read only. Return to the staff workspace to make changes.")
}

/** Resolve a read without changing the authenticated actor or other tabs. */
export async function requireProjectAudienceReadUser(projectId: string): Promise<import("@/lib/auth").AuthUser> {
  const scope = await getProjectAudienceRequestScope()
  if (!scope) return requireAuth()
  const { resolveProjectAudienceViewer } = await import("@/lib/project-audience-viewer")
  const context = await resolveProjectAudienceViewer(projectId, scope.audience)
  if (!context.viewer) throw new Error("Select a person to preview this section.")
  return context.viewer
}

export async function audienceReadCacheControl(): Promise<"private, no-store" | "private, max-age=300"> {
  return await getProjectAudienceRequestScope() ? "private, no-store" : "private, max-age=300"
}

/** A resource ID cannot use another project's grants through a preview. */
export async function assertAudienceResourceProject(projectId: string): Promise<void> {
  const scope = await getProjectAudienceRequestScope()
  if (scope && scope.projectId !== await resolveProjectRouteId(projectId)) throw new Error("Record not found.")
}
