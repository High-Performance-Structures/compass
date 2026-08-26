export type SidebarContextMode = "main" | "files" | "conversations"

export function getProjectTargetSection(
  pathname: string | null,
): string | undefined {
  const suffix = pathname?.match(
    /^\/dashboard\/projects\/[^/]+(?:\/(.*))?$/,
  )?.[1]
  if (!suffix) return undefined

  const [section, detail] = suffix.split("/")
  if (section === "preview") {
    return detail === "owner" || detail === "sub-vendor"
      ? `preview/${detail}`
      : undefined
  }

  switch (section) {
    case "budget":
    case "change-orders":
    case "contacts":
    case "conversations":
    case "daily-logs":
    case "estimate":
    case "financials":
    case "owner-updates":
    case "photos":
    case "purchase-orders":
    case "rfis":
    case "rfqs":
    case "schedule":
    case "selections":
    case "todos":
    case "videos":
    case "warranty":
      return section
    default:
      return undefined
  }
}

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
