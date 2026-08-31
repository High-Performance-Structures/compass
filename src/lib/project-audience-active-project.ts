import type { ProjectAudiencePreviewRoute } from "@/lib/project-audience-preview-routes"

const ACTIVE_PROJECT_COOKIE_PREFIX = "compass_audience_active_project"

export function projectAudienceActiveProjectCookieName(
  audience: ProjectAudiencePreviewRoute
): string {
  return `${ACTIVE_PROJECT_COOKIE_PREFIX}_${audience.replace("-", "_")}`
}

export function resolveProjectAudienceActiveProject(
  projects: readonly { readonly id: string }[],
  preferredProjectId: string | null
): string | null {
  if (
    preferredProjectId &&
    projects.some((project) => project.id === preferredProjectId)
  ) {
    return preferredProjectId
  }

  return projects[0]?.id ?? null
}
