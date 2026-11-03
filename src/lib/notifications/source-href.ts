import { projectPurchaseOrderHref, projectRfiHref, projectTodoHref, scheduleItemHref } from "@/lib/work-calendar"

type NotificationSource = {
  readonly projectId: string | null
  readonly sourceType: string
  readonly sourceId: string | null
  readonly href: string
}

/** Focus known record workspaces without guessing new routes or changing audiences. */
export function notificationSourceHref(input: NotificationSource): string {
  const { projectId, sourceType, sourceId, href } = input
  if (!projectId || !sourceId || !href.startsWith("/dashboard/projects/")) return href
  const base = `/dashboard/projects/${encodeURIComponent(projectId)}`
  let destination: string
  let workspace: string
  switch (sourceType) {
    case "rfi": workspace = "rfis"; destination = projectRfiHref(projectId, sourceId); break
    case "purchase_order": workspace = "purchase-orders"; destination = projectPurchaseOrderHref(projectId, sourceId); break
    case "rfq": workspace = "rfqs"; destination = `${base}/rfqs?status=all&item=${encodeURIComponent(sourceId)}#rfq-${encodeURIComponent(sourceId)}`; break
    case "task": workspace = "todos"; destination = projectTodoHref(projectId, sourceId); break
    case "schedule_item": case "schedule_task": workspace = "schedule"; destination = scheduleItemHref(projectId, sourceId); break
    default: return href
  }
  try {
    const url = new URL(href, "https://compass.local")
    // Outside replies and other specialized links keep their own source view.
    if (url.pathname !== `${base}/${workspace}` && !(sourceType === "task" && url.pathname === base)) return href
    const target = new URL(destination, "https://compass.local")
    for (const [key, value] of url.searchParams) if (!target.searchParams.has(key)) target.searchParams.append(key, value)
    return `${target.pathname}?${target.searchParams.toString()}${target.hash}`
  } catch { return href }
}
