"use client"

import { useAlertCount } from "@/hooks/use-alert-count"
import type { NavItem } from "@/components/nav-main"

// Reading on the Messages page changes only the query string; recount soon after.
const MESSAGES_NAVIGATION_MIN_MS = 10 * 1000

/**
 * Unread emails and conversations on a job, for its Messages link. `location`
 * is the path plus query string, so opening a conversation recounts.
 */
export function useProjectMessagesUnread(projectId: string | null, location: string): number {
  return useAlertCount(
    projectId ? `/api/projects/${encodeURIComponent(projectId)}/messages/unread-count` : "",
    projectId !== null,
    location,
    MESSAGES_NAVIGATION_MIN_MS,
  )
}

/** Puts the job's unread message count on its Messages link. */
export function withMessagesUnread(items: ReadonlyArray<NavItem>, count: number): ReadonlyArray<NavItem> {
  if (count === 0) return items
  return items.map((item) =>
    item.kind === "group"
      ? {
          ...item,
          items: item.items.map((child) =>
            child.kind === "link" && child.url.endsWith("/messages")
              ? { ...child, alert: { count, label: `${count} unread`, tone: "unread" as const } }
              : child,
          ),
        }
      : item,
  )
}
