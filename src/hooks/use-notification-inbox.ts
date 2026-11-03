"use client"

import * as React from "react"
import {
  markNotificationRead,
  setNotificationsDismissed,
  type NotificationCenterItem,
  type NotificationCenterScope,
} from "@/app/actions/notifications"
import type { NotificationRow } from "@/components/notifications/inbox-row"
import { useNotificationCenter } from "@/components/notifications/notification-center-provider"
import { announceNotificationsChanged } from "@/lib/notifications/client-events"

export type NotificationInbox = {
  readonly items: readonly NotificationCenterItem[]
  readonly loaded: boolean
  readonly markRead: (row: NotificationRow) => Promise<void>
  readonly done: (row: NotificationRow) => Promise<void>
}

const INBOX_REFRESH_MS = 30_000

/**
 * The viewer's bell items for views other than the bell (the map's Messages
 * layer). Loads only while `enabled`, refreshes on a visible-tab poll and on
 * NOTIFICATIONS_CHANGED_EVENT, and announces its own changes so the bell
 * follows. Under the dashboard layout it shares one source (and one poll)
 * with the bell; see NotificationCenterProvider.
 *
 * Office staff omit `scopes` (whole organization). Owners and sub/vendors
 * pass one scope per project they can open; each is checked server-side and
 * only that project's items come back.
 */
export function useNotificationInbox(
  enabled: boolean,
  scopes?: readonly NotificationCenterScope[],
): NotificationInbox {
  const { items, loaded, refresh, update, scopeFor } = useNotificationCenter(scopes, {
    enabled,
    intervalMs: INBOX_REFRESH_MS,
  })

  const markRead = React.useCallback(async (row: NotificationRow): Promise<void> => {
    const unread = row.items.filter((item) => item.readAt === null)
    if (unread.length === 0) return
    const ids = new Set(unread.map((item) => item.id))
    const now = new Date().toISOString()
    update((current) => current.map((item) => (ids.has(item.id) ? { ...item, readAt: now } : item)))
    await Promise.all(unread.map((item) => markNotificationRead(item.id, scopeFor(item)).catch(() => undefined)))
    announceNotificationsChanged()
  }, [scopeFor, update])

  const done = React.useCallback(async (row: NotificationRow): Promise<void> => {
    const ids = row.items.map((item) => item.id)
    const removed = new Set(ids)
    update((current) => current.filter((item) => !removed.has(item.id)))
    const first = row.items[0]
    const result = await setNotificationsDismissed(ids, true, first ? scopeFor(first) : undefined)
    if (!result.success) void refresh()
    announceNotificationsChanged()
  }, [refresh, scopeFor, update])

  return { items, loaded, markRead, done }
}
