export const QUICK_ADD_ACTIONS = [
  "message",
  "daily-log",
  "todo",
  "schedule-item",
  "rfi",
  "purchase-order",
  "rfq",
  "change-request",
  "warranty-request",
] as const

export type QuickAddAction = (typeof QUICK_ADD_ACTIONS)[number]
export type QuickAddWorkspace = "staff" | "owner" | "sub_vendor"

export type QuickAddDestination = {
  readonly action: QuickAddAction
  readonly href: string
}

export type QuickAddProject = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
  readonly actions: readonly QuickAddDestination[]
}

export const QUICK_ADD_ACTION_LABELS: Readonly<Record<QuickAddAction, string>> =
  {
    message: "Project Message",
    "daily-log": "Daily Log",
    todo: "To-Do",
    "schedule-item": "Schedule Item",
    rfi: "RFI",
    "purchase-order": "Purchase Order",
    rfq: "RFQ",
    "change-request": "Change Request",
    "warranty-request": "Warranty Request",
  }

export function quickAddHref(
  action: QuickAddAction,
  projectId: string,
  workspace: QuickAddWorkspace,
): string {
  const encodedProjectId = encodeURIComponent(projectId)
  if (workspace === "owner") {
    const section =
      action === "change-request"
        ? "change-orders"
        : action === "warranty-request"
          ? "warranty"
          : "conversations"
    return `/preview/projects/${encodedProjectId}/owner/${section}?quickAdd=${action}`
  }
  if (workspace === "sub_vendor") {
    const section =
      action === "rfi"
        ? "rfis"
        : action === "change-request"
          ? "change-orders"
          : "conversations"
    return `/preview/projects/${encodedProjectId}/sub-vendor/${section}?quickAdd=${action}`
  }

  const section =
    action === "change-request"
      ? "change-orders"
      : action === "warranty-request"
        ? "warranty"
        : action === "message"
          ? "messages"
          : action === "daily-log"
            ? "daily-logs"
            : action === "schedule-item"
              ? "schedule"
              : action === "rfi"
                ? "rfis"
                : action === "purchase-order"
                  ? "purchase-orders"
                  : action === "rfq"
                    ? "rfqs"
                    : "todos"
  return `/dashboard/projects/${encodedProjectId}/${section}?quickAdd=${action}`
}
