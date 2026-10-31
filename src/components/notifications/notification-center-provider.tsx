"use client"

import * as React from "react"
import {
  getNotificationCenter,
  type NotificationCenterItem,
  type NotificationCenterScope,
} from "@/app/actions/notifications"
import { useVisibleInterval } from "@/hooks/use-visible-interval"
import { NOTIFICATIONS_CHANGED_EVENT } from "@/lib/notifications/client-events"
import {
  EMPTY_NOTIFICATION_SOURCE,
  NOTIFICATION_TICK_MS,
  NotificationCenterStore,
  notificationScopeKey,
  type NotificationCenterLoader,
  type NotificationScopes,
  type NotificationSourceState,
} from "@/components/notifications/notification-center-store"

const NotificationCenterContext = React.createContext<NotificationCenterStore | null>(null)

/**
 * Drives a store: the shared visible-tab tick, focus refreshes, and
 * NOTIFICATIONS_CHANGED_EVENT. Exactly one driver runs per store.
 */
function useNotificationCenterDriver(store: NotificationCenterStore | null): void {
  useVisibleInterval(() => store?.tick(), NOTIFICATION_TICK_MS, {
    enabled: store !== null,
    immediate: false,
  })
  React.useEffect(() => {
    if (!store) return
    const refreshAll = (): void => store.refreshAll()
    const refreshOnFocus = (): void => {
      if (document.visibilityState === "visible") store.refreshOnFocus()
    }
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, refreshAll)
    window.addEventListener("focus", refreshOnFocus)
    return () => {
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, refreshAll)
      window.removeEventListener("focus", refreshOnFocus)
    }
  }, [store])
}

/**
 * Mounted once in the dashboard layout. Every notification view below it
 * (the header bells, the map's Messages layer, outside-viewer job pages)
 * reads one shared source per scope set and one poll.
 */
export function NotificationCenterProvider({
  children,
  loader = getNotificationCenter,
}: {
  readonly children: React.ReactNode
  /** Tests only. */
  readonly loader?: NotificationCenterLoader
}): React.ReactElement {
  const [store] = React.useState(() => new NotificationCenterStore(loader))
  useNotificationCenterDriver(store)
  return (
    <NotificationCenterContext.Provider value={store}>
      {children}
    </NotificationCenterContext.Provider>
  )
}

export type NotificationCenterView = NotificationSourceState & {
  /** Load now (opening the bell, after a failed write). */
  readonly refresh: () => Promise<void>
  /** Optimistic local change, shared with every view of the same scopes. */
  readonly update: (
    change: (items: readonly NotificationCenterItem[]) => readonly NotificationCenterItem[],
  ) => void
  /** The scope a write about this item must use (undefined for office staff). */
  readonly scopeFor: (item: NotificationCenterItem) => NotificationCenterScope | undefined
}

/**
 * The viewer's notification items for `scopes`. Inside the provider every
 * caller with the same scopes shares one source; outside it (a page rendered
 * without the dashboard layout) the hook runs its own private source.
 */
export function useNotificationCenter(
  scopes: NotificationScopes,
  options: {
    readonly enabled: boolean
    readonly intervalMs: number
    readonly refreshOnFocus?: boolean
  },
): NotificationCenterView {
  const shared = React.useContext(NotificationCenterContext)
  const [local] = React.useState(() =>
    shared ? null : new NotificationCenterStore(getNotificationCenter),
  )
  useNotificationCenterDriver(local)
  const store = shared ?? local
  const key = notificationScopeKey(scopes)
  const active = options.enabled && key !== "" && store !== null
  const intervalMs = options.intervalMs
  const refreshOnFocus = options.refreshOnFocus ?? false
  // A stable key means a new array with the same scopes doesn't resubscribe.
  const scopesRef = React.useRef(scopes)
  scopesRef.current = scopes

  const subscribe = React.useCallback(
    (listener: () => void): (() => void) => {
      if (!active || !store) return () => undefined
      return store.subscribe(key, scopesRef.current, { intervalMs, refreshOnFocus }, listener)
    },
    [active, intervalMs, key, refreshOnFocus, store],
  )
  const getSnapshot = React.useCallback(
    (): NotificationSourceState =>
      active && store ? store.getSnapshot(key) : EMPTY_NOTIFICATION_SOURCE,
    [active, key, store],
  )
  const state = React.useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_NOTIFICATION_SOURCE)

  const refresh = React.useCallback(async (): Promise<void> => {
    if (active && store) await store.load(key)
  }, [active, key, store])
  const update = React.useCallback(
    (change: (items: readonly NotificationCenterItem[]) => readonly NotificationCenterItem[]): void => {
      if (active && store) store.update(key, change)
    },
    [active, key, store],
  )
  const scopeFor = React.useCallback(
    (item: NotificationCenterItem): NotificationCenterScope | undefined => {
      const list = (store?.scopesFor(key) ?? scopesRef.current)
      if (!list) return undefined
      return list.find((scope) => scope.projectId === item.projectId) ?? list[0]
    },
    [key, store],
  )

  return React.useMemo(
    () => ({ items: state.items, loaded: state.loaded, refresh, update, scopeFor }),
    [refresh, scopeFor, state, update],
  )
}
