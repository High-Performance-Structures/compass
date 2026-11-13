"use client"

import * as React from "react"

import { useAlertCount } from "@/hooks/use-alert-count"
import type { NavItem } from "@/components/nav-main"

// Reading on the Messages page changes only the query string. Recount at once
// and again shortly after, once the opened conversation is marked read.
const MESSAGES_NAVIGATION_MIN_MS = 2 * 1000
const AFTER_READ_RECOUNT_MS = 3 * 1000

/**
 * Unread emails and conversations on a job, for its Messages link. `location`
 * is the path plus query string, so opening a conversation recounts.
 */
export function useProjectMessagesUnread(projectId: string | null, location: string): number {
  const [settled, setSettled] = React.useState(location)
  React.useEffect(() => {
    const timer = window.setTimeout(() => setSettled(location), AFTER_READ_RECOUNT_MS)
    return () => window.clearTimeout(timer)
  }, [location])
  return useAlertCount(
    projectId ? `/api/projects/${encodeURIComponent(projectId)}/messages/unread-count` : "",
    projectId !== null,
    settled === location ? `${location}#settled` : location,
    MESSAGES_NAVIGATION_MIN_MS,
  )
}

/** Puts the job's unread message count on its Messages link. */
export function withMessagesUnread(items: ReadonlyArray<NavItem>, projectId: string | null, count: number): ReadonlyArray<NavItem> {
  if (count === 0 || projectId === null) return items
  const messagesUrl = `/dashboard/projects/${projectId}/messages`
  return items.map((item) =>
    item.kind === "group"
      ? {
          ...item,
          items: item.items.map((child) =>
            child.kind === "link" && child.url === messagesUrl
              ? { ...child, alert: { count, label: `${count} unread`, tone: "unread" as const } }
              : child,
          ),
        }
      : item,
  )
}
