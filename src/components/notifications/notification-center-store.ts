import type {
  getNotificationCenter,
  NotificationCenterItem,
  NotificationCenterScope,
} from "@/app/actions/notifications"

export type NotificationCenterLoader = typeof getNotificationCenter

/** Office staff pass no scopes (whole organization); outside viewers pass one per project. */
export type NotificationScopes = readonly NotificationCenterScope[] | undefined

export type NotificationSourceState = {
  readonly items: readonly NotificationCenterItem[]
  /** False until the first load for this scope set finishes. */
  readonly loaded: boolean
}

export type NotificationSubscription = {
  /** How often this view wants fresh items while the tab is visible. */
  readonly intervalMs: number
  /** Refresh when the window regains focus (the bell does). */
  readonly refreshOnFocus: boolean
}

export const NO_NOTIFICATION_ITEMS: readonly NotificationCenterItem[] = []
export const EMPTY_NOTIFICATION_SOURCE: NotificationSourceState = {
  items: NO_NOTIFICATION_ITEMS,
  loaded: false,
}

/**
 * How often the provider checks which sources are due. Cheap (no network
 * unless a source is due), and fine enough that a 15 s or 30 s source is
 * refreshed within a few seconds of its time.
 */
export const NOTIFICATION_TICK_MS = 5_000
// A new view joining a source loaded this recently reuses that answer.
const JOIN_RELOAD_AFTER_MS = 5_000
// Timer jitter: a source due in a moment counts as due now.
const DUE_SLACK_MS = 250

/** One key per distinct scope set; "" means "no scopes", which loads nothing. */
export function notificationScopeKey(scopes: NotificationScopes): string {
  if (!scopes) return "org"
  return scopes.map((scope) => `${scope.audience}:${scope.projectId}`).join("|")
}

type Source = {
  readonly scopes: NotificationScopes
  state: NotificationSourceState
  readonly subscriptions: Map<number, NotificationSubscription>
  readonly listeners: Set<() => void>
  sequence: number
  lastRequestedAt: number
}

/**
 * One shared copy of the viewer's notification items per scope set, so the
 * bell, the map's Messages layer, and outside-viewer pages read one source
 * and one poll instead of each fetching the same action.
 */
export class NotificationCenterStore {
  private readonly sources = new Map<string, Source>()
  private nextSubscriptionId = 1

  constructor(
    private readonly loader: NotificationCenterLoader,
    private readonly now: () => number = Date.now,
  ) {}

  subscribe(
    key: string,
    scopes: NotificationScopes,
    subscription: NotificationSubscription,
    listener: () => void,
  ): () => void {
    let source = this.sources.get(key)
    if (!source) {
      source = {
        scopes,
        state: EMPTY_NOTIFICATION_SOURCE,
        subscriptions: new Map(),
        listeners: new Set(),
        sequence: 0,
        lastRequestedAt: Number.NEGATIVE_INFINITY,
      }
      this.sources.set(key, source)
    }
    const id = this.nextSubscriptionId++
    source.subscriptions.set(id, subscription)
    source.listeners.add(listener)
    if (this.now() - source.lastRequestedAt >= JOIN_RELOAD_AFTER_MS) void this.load(key)

    const owned = source
    return () => {
      owned.subscriptions.delete(id)
      owned.listeners.delete(listener)
      if (owned.subscriptions.size === 0 && this.sources.get(key) === owned) {
        // Drop late answers and forget the items; the next view loads fresh.
        owned.sequence += 1
        this.sources.delete(key)
      }
    }
  }

  getSnapshot(key: string): NotificationSourceState {
    return this.sources.get(key)?.state ?? EMPTY_NOTIFICATION_SOURCE
  }

  scopesFor(key: string): NotificationScopes {
    return this.sources.get(key)?.scopes
  }

  /** Load now; the latest request wins if several overlap. */
  async load(key: string): Promise<void> {
    const source = this.sources.get(key)
    if (!source) return
    const request = ++source.sequence
    source.lastRequestedAt = this.now()
    const scopes = source.scopes
    let next: readonly NotificationCenterItem[] | null
    if (!scopes) {
      // Whole organization: a failed load keeps the last good list.
      try {
        const result = await this.loader()
        next = result.success ? result.data.items : null
      } catch {
        next = null
      }
    } else {
      // Outside workspaces fail closed per project: a scope that cannot be
      // read contributes nothing, so stale items never cross scopes.
      const results = await Promise.all(
        scopes.map((scope) => this.loader(scope).catch(() => null)),
      )
      if (results.length === 1) {
        const only = results[0]
        next = only?.success ? only.data.items : NO_NOTIFICATION_ITEMS
      } else {
        const merged = new Map<string, NotificationCenterItem>()
        for (const result of results) {
          if (!result?.success) continue
          for (const item of result.data.items) merged.set(item.id, item)
        }
        next = [...merged.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      }
    }
    if (request !== source.sequence || this.sources.get(key) !== source) return
    this.set(source, { items: next ?? source.state.items, loaded: true })
  }

  /** Optimistic local change (mark read, done, clear) visible to every view. */
  update(
    key: string,
    change: (items: readonly NotificationCenterItem[]) => readonly NotificationCenterItem[],
  ): void {
    const source = this.sources.get(key)
    if (!source) return
    this.set(source, { ...source.state, items: change(source.state.items) })
  }

  /** Refresh every source whose most eager view is due. */
  tick(): void {
    const now = this.now()
    for (const [key, source] of this.sources) {
      let interval = Number.POSITIVE_INFINITY
      for (const subscription of source.subscriptions.values()) {
        interval = Math.min(interval, subscription.intervalMs)
      }
      if (now - source.lastRequestedAt >= interval - DUE_SLACK_MS) void this.load(key)
    }
  }

  /** Something changed the viewer's notifications: refresh every source. */
  refreshAll(): void {
    for (const key of this.sources.keys()) void this.load(key)
  }

  /** The window regained focus: refresh sources a view asked to refresh on focus. */
  refreshOnFocus(): void {
    for (const [key, source] of this.sources) {
      if ([...source.subscriptions.values()].some((subscription) => subscription.refreshOnFocus)) {
        void this.load(key)
      }
    }
  }

  private set(source: Source, state: NotificationSourceState): void {
    source.state = state
    for (const listener of source.listeners) listener()
  }
}
