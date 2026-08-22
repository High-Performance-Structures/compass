export type SidebarContextMode = "main" | "files" | "conversations"

export function getSidebarContextMode(
  pathname: string | null,
  isExpanded: boolean,
): SidebarContextMode {
  if (!isExpanded) return "main"
  if (pathname?.startsWith("/dashboard/files")) return "files"
  if (pathname?.startsWith("/dashboard/conversations")) {
    return "conversations"
  }

  // Project routes keep the same grouped Compass menu. Its project-scoped
  // links are resolved against the active project by AppSidebar.
  return "main"
}
