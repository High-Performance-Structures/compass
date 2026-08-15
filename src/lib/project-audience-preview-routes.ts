export type ProjectAudiencePreviewRoute = "owner" | "sub-vendor"
export type ProjectAudienceWorkspaceSection =
  | "overview"
  | "updates"
  | "schedule"
  | "budget"
  | "commitments"
  | "rfis"
  | "change-orders"
  | "conversations"
  | "photos"
  | "files"
  | "team"

export function projectAudiencePreviewHref(
  projectId: string,
  audience: ProjectAudiencePreviewRoute
): string {
  return `/preview/projects/${encodeURIComponent(projectId)}/${audience}`
}

export function projectAudienceSectionHref(
  projectId: string,
  audience: ProjectAudiencePreviewRoute,
  section: ProjectAudienceWorkspaceSection
): string {
  const homeHref = projectAudiencePreviewHref(projectId, audience)
  return section === "overview" ? homeHref : `${homeHref}/${section}`
}

export function ownerUpdatePreviewHref(
  projectId: string,
  updateId: string
): string {
  return `${projectAudiencePreviewHref(projectId, "owner")}/updates/${encodeURIComponent(updateId)}`
}

export function projectAudienceConversationHref(
  projectId: string,
  audience: ProjectAudiencePreviewRoute,
  channelId: string
): string {
  return (
    `${projectAudiencePreviewHref(projectId, audience)}` +
    `/conversations/${encodeURIComponent(channelId)}`
  )
}
