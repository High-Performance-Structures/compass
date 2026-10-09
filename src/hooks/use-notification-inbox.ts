"use client"

import * as React from "react"
import {
  getNotificationCenter,
  markNotificationRead,
  setNotificationsDismissed,
  type NotificationCenterItem,
} from "@/app/actions/notifications"
import type { NotificationRow } from "@/components/notifications/inbox-row"
import {
  announceNotificationsChanged,
  NOTIFICATIONS_CHANGED_EVENT,
} from "@/lib/notifications/client-events"

export type NotificationInbox = {
  readonly items: readonly NotificationCenterItem[]
  readonly loaded: boolean
  readonly markRead: (row: NotificationRow) => Promise<void>
  readonly done: (row: NotificationRow) => Promise<void>
}

const NO_ITEMS: readonly NotificationCenterItem[] = []

/**
 * The viewer's bell items for views other than the bell (the map's Messages
 * layer). Loads only while `enabled`, refreshes on a visible-tab poll and on
 * NOTIFICATIONS_CHANGED_EVENT, and announces its own changes so the bell
 * follows.
 */
export function useNotificationInbox(enabled: boolean): NotificationInbox {
  const [items, setItems] = React.useState<readonly NotificationCenterItem[]>(NO_ITEMS)
  const [loaded, setLoaded] = React.useState(false)
  const sequence = React.useRef(0)

  const load = React.useCallback(async (): Promise<void> => {
    const request = ++sequence.current
    try {
      const result = await getNotificationCenter()
      if (request !== sequence.current) return
      if (result.success) setItems(result.data.items)
    } catch {
      // Keep the last good list; the next refresh tries again.
    } finally {
      if (request === sequence.current) setLoaded(true)
    }
  }, [])

  React.useEffect(() => {
    if (!enabled) {
      sequence.current += 1
      setItems(NO_ITEMS)
      setLoaded(false)
      return
    }
    void load()
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void load()
    }, 30_000)
    const refresh = (): void => void load()
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, refresh)
    return () => {
      sequence.current += 1
      window.clearInterval(interval)
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, refresh)
    }
  }, [enabled, load])

  const markRead = React.useCallback(async (row: NotificationRow): Promise<void> => {
    const unread = row.items.filter((item) => item.readAt === null)
    if (unread.length === 0) return
    const ids = new Set(unread.map((item) => item.id))
    const now = new Date().toISOString()
    setItems((current) => current.map((item) => (ids.has(item.id) ? { ...item, readAt: now } : item)))
    await Promise.all(unread.map((item) => markNotificationRead(item.id).catch(() => undefined)))
    announceNotificationsChanged()
  }, [])

  const done = React.useCallback(async (row: NotificationRow): Promise<void> => {
    const ids = row.items.map((item) => item.id)
    const removed = new Set(ids)
    setItems((current) => current.filter((item) => !removed.has(item.id)))
    const result = await setNotificationsDismissed(ids, true)
    if (!result.success) void load()
    announceNotificationsChanged()
  }, [load])

  return { items, loaded, markRead, done }
}
