export type ProjectAudiencePreviewRoute = "owner" | "sub-vendor"

export function projectAudiencePreviewHref(
  projectId: string,
  audience: ProjectAudiencePreviewRoute
): string {
  return `/preview/projects/${encodeURIComponent(projectId)}/${audience}`
}

export function ownerUpdatePreviewHref(
  projectId: string,
  updateId: string
): string {
  return `${projectAudiencePreviewHref(projectId, "owner")}/updates/${encodeURIComponent(updateId)}`
}
