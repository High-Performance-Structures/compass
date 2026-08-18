export type WorkspacePhotoCacheScope = Readonly<{
  organizationId: string
  userId: string
}>

function workspacePhotoStorageKey(
  slot: "dashboard" | "sidebar",
  scope: WorkspacePhotoCacheScope
): string {
  return `compass-workspace-photo:${scope.organizationId}:${scope.userId}:${slot}`
}

export function dashboardDeskPhotoStorageKey(
  scope: WorkspacePhotoCacheScope
): string {
  return workspacePhotoStorageKey("dashboard", scope)
}

export function sidebarDeskPhotoStorageKey(
  scope: WorkspacePhotoCacheScope
): string {
  return workspacePhotoStorageKey("sidebar", scope)
}
