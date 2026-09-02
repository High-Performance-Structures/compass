import type { AuthUser } from "@/lib/auth"
import { isDemoOrg, isDemoUser } from "@/lib/demo"
import { isInternalStaffRole } from "@/lib/user-roles"

export const QUICK_ADD_ACTIONS = [
  "daily-log",
  "schedule-item",
  "todo",
] as const

export type QuickAddAction = (typeof QUICK_ADD_ACTIONS)[number]

export type QuickAddPermissions = {
  readonly dailyLog: boolean
  readonly scheduleItem: boolean
  readonly todo: boolean
}

const ACTION_PERMISSION_KEYS: Readonly<Record<QuickAddAction, keyof QuickAddPermissions>> = {
  "daily-log": "dailyLog",
  "schedule-item": "scheduleItem",
  todo: "todo",
}

export const QUICK_ADD_ACTION_LABELS: Readonly<Record<QuickAddAction, string>> = {
  "daily-log": "Daily Log",
  "schedule-item": "Schedule Item",
  todo: "To-Do",
}

export function getQuickAddActions(
  user: AuthUser | null,
  permissions: QuickAddPermissions,
): QuickAddAction[] {
  if (
    !user ||
    !user.isActive ||
    !user.organizationId ||
    user.organizationType !== "internal" ||
    isDemoUser(user.id) ||
    isDemoOrg(user.organizationId) ||
    !isInternalStaffRole(user.role)
  ) {
    return []
  }

  return QUICK_ADD_ACTIONS.filter(
    (action) => permissions[ACTION_PERMISSION_KEYS[action]],
  )
}

export function quickAddHref(
  action: QuickAddAction,
  projectId: string,
): string {
  const encodedProjectId = encodeURIComponent(projectId)
  const section =
    action === "daily-log"
      ? "daily-logs"
      : action === "schedule-item"
        ? "schedule"
        : "todos"
  return `/dashboard/projects/${encodedProjectId}/${section}?quickAdd=${action}`
}
