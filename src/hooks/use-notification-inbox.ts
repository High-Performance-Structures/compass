"use client"

import * as React from "react"
import {
  getNotificationCenter,
  markNotificationRead,
  setNotificationsDismissed,
  type NotificationCenterItem,
  type NotificationCenterScope,
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
 *
 * Office staff omit `scopes` (whole organization). Owners and sub/vendors
 * pass one scope per project they can open; each is checked server-side and
 * only that project's items come back.
 */
export function useNotificationInbox(
  enabled: boolean,
  scopes?: readonly NotificationCenterScope[],
): NotificationInbox {
  const [items, setItems] = React.useState<readonly NotificationCenterItem[]>(NO_ITEMS)
  const [loaded, setLoaded] = React.useState(false)
  const sequence = React.useRef(0)
  // A stable key so a new array with the same scopes doesn't reload.
  const scopeKey = scopes ? scopes.map((scope) => `${scope.audience}:${scope.projectId}`).join("|") : "org"
  const scopesRef = React.useRef(scopes)
  scopesRef.current = scopes

  const scopeFor = React.useCallback((item: NotificationCenterItem): NotificationCenterScope | undefined => {
    const list = scopesRef.current
    if (!list) return undefined
    return list.find((scope) => scope.projectId === item.projectId) ?? list[0]
  }, [])

  const load = React.useCallback(async (): Promise<void> => {
    const request = ++sequence.current
    try {
      const list = scopesRef.current
      const results = list
        ? await Promise.all(list.map((scope) => getNotificationCenter(scope)))
        : [await getNotificationCenter()]
      if (request !== sequence.current) return
      const merged = new Map<string, NotificationCenterItem>()
      for (const result of results) {
        if (!result.success) continue
        for (const item of result.data.items) merged.set(item.id, item)
      }
      setItems([...merged.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
    } catch {
      // Keep the last good list; the next refresh tries again.
    } finally {
      if (request === sequence.current) setLoaded(true)
    }
  }, [])

  React.useEffect(() => {
    if (!enabled || scopeKey === "") {
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
  }, [enabled, load, scopeKey])

  const markRead = React.useCallback(async (row: NotificationRow): Promise<void> => {
    const unread = row.items.filter((item) => item.readAt === null)
    if (unread.length === 0) return
    const ids = new Set(unread.map((item) => item.id))
    const now = new Date().toISOString()
    setItems((current) => current.map((item) => (ids.has(item.id) ? { ...item, readAt: now } : item)))
    await Promise.all(unread.map((item) => markNotificationRead(item.id, scopeFor(item)).catch(() => undefined)))
    announceNotificationsChanged()
  }, [scopeFor])

  const done = React.useCallback(async (row: NotificationRow): Promise<void> => {
    const ids = row.items.map((item) => item.id)
    const removed = new Set(ids)
    setItems((current) => current.filter((item) => !removed.has(item.id)))
    const first = row.items[0]
    const result = await setNotificationsDismissed(ids, true, first ? scopeFor(first) : undefined)
    if (!result.success) void load()
    announceNotificationsChanged()
  }, [load, scopeFor])

  return { items, loaded, markRead, done }
}
