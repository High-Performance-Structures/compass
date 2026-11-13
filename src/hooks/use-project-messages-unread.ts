"use client"

import { useAlertCount } from "@/hooks/use-alert-count"
import type { NavItem } from "@/components/nav-main"

/** Unread emails and conversations on the active job, for its Messages link. */
export function useProjectMessagesUnread(projectId: string | null, pathname: string): number {
  return useAlertCount(
    projectId ? `/api/projects/${encodeURIComponent(projectId)}/messages/unread-count` : "",
    projectId !== null,
    pathname,
  )
}

/** Puts the job's unread message count on its Messages link. */
export function withMessagesUnread(items: ReadonlyArray<NavItem>, count: number): ReadonlyArray<NavItem> {
  if (count === 0) return items
  return items.map((item) =>
    item.kind === "group" && item.title === "Projects"
      ? {
          ...item,
          items: item.items.map((child) =>
            child.kind === "link" && child.title === "Messages"
              ? { ...child, alert: { count, label: `${count} unread ${count === 1 ? "conversation" : "conversations"}`, tone: "unread" as const } }
              : child,
          ),
        }
      : item,
  )
}
