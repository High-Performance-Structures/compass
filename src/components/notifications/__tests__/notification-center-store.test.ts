import { describe, expect, it, vi } from "vitest"
import type { NotificationCenterItem, NotificationCenterScope } from "@/app/actions/notifications"
import {
  NotificationCenterStore,
  notificationScopeKey,
  type NotificationCenterLoader,
} from "../notification-center-store"

function item(id: string, createdAt: string, projectId: string | null = null): NotificationCenterItem {
  return {
    id,
    eventId: `event-${id}`,
    title: id,
    body: "",
    href: "/dashboard",
    priority: "normal",
    eventType: "project_message",
    sourceType: "message",
    projectId,
    projectLabel: null,
    readAt: null,
    createdAt,
  }
}

function ok(items: readonly NotificationCenterItem[]): Awaited<ReturnType<NotificationCenterLoader>> {
  return { success: true, data: { unreadCount: items.length, items } }
}

const flush = async (): Promise<void> => {
  for (let index = 0; index < 5; index += 1) await Promise.resolve()
}

const BELL = { intervalMs: 15_000, refreshOnFocus: true }
const INBOX = { intervalMs: 30_000, refreshOnFocus: false }

describe("NotificationCenterStore", () => {
  it("shares one load between views of the same scope", async () => {
    const loader = vi.fn<NotificationCenterLoader>(async () => ok([item("a", "2026-10-30T00:00:00Z")]))
    let now = 0
    const store = new NotificationCenterStore(loader, () => now)
    const first = vi.fn()
    const second = vi.fn()
    store.subscribe("org", undefined, BELL, first)
    store.subscribe("org", undefined, INBOX, second)
    await flush()
    expect(loader).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot("org")).toMatchObject({ loaded: true })
    expect(first).toHaveBeenCalled()
    expect(second).toHaveBeenCalled()

    // The most eager view sets the pace: due after 15 s, not twice.
    now = 10_000
    store.tick()
    expect(loader).toHaveBeenCalledTimes(1)
    now = 15_000
    store.tick()
    await flush()
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it("polls an inbox-only source every 30 s", async () => {
    const loader = vi.fn<NotificationCenterLoader>(async () => ok([]))
    let now = 1_000_000
    const store = new NotificationCenterStore(loader, () => now)
    store.subscribe("org", undefined, INBOX, () => undefined)
    now += 15_000
    store.tick()
    expect(loader).toHaveBeenCalledTimes(1)
    now += 15_000
    store.tick()
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it("keeps the last good organization list when a load fails", async () => {
    const loader = vi
      .fn<NotificationCenterLoader>()
      .mockResolvedValueOnce(ok([item("a", "2026-10-30T00:00:00Z")]))
      .mockResolvedValueOnce({ success: false, error: "nope" })
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
    const store = new NotificationCenterStore(loader)
    store.subscribe("org", undefined, BELL, () => undefined)
    await flush()
    await store.load("org")
    await store.load("org")
    expect(store.getSnapshot("org").items.map((entry) => entry.id)).toEqual(["a"])
  })

  it("fails closed per project scope and merges newest first", async () => {
    const scopes: NotificationCenterScope[] = [
      { projectId: "p1", audience: "owner" },
      { projectId: "p2", audience: "owner" },
    ]
    const loader = vi.fn<NotificationCenterLoader>(async (scope) =>
      scope?.projectId === "p1"
        ? ok([item("old", "2026-10-01T00:00:00Z", "p1")])
        : ok([item("new", "2026-10-29T00:00:00Z", "p2")])
    )
    const store = new NotificationCenterStore(loader)
    const key = notificationScopeKey(scopes)
    store.subscribe(key, scopes, INBOX, () => undefined)
    await flush()
    expect(store.getSnapshot(key).items.map((entry) => entry.id)).toEqual(["new", "old"])

    loader.mockImplementation(async (scope) => {
      if (scope?.projectId === "p1") throw new Error("gone")
      return ok([item("new", "2026-10-29T00:00:00Z", "p2")])
    })
    await store.load(key)
    expect(store.getSnapshot(key).items.map((entry) => entry.id)).toEqual(["new"])
  })

  it("clears a single external scope that cannot be read", async () => {
    const scope: NotificationCenterScope = { projectId: "p1", audience: "sub_vendor" }
    const loader = vi
      .fn<NotificationCenterLoader>()
      .mockResolvedValueOnce(ok([item("a", "2026-10-30T00:00:00Z", "p1")]))
      .mockResolvedValueOnce({ success: false, error: "no access" })
    const store = new NotificationCenterStore(loader)
    const key = notificationScopeKey([scope])
    store.subscribe(key, [scope], BELL, () => undefined)
    await flush()
    expect(store.getSnapshot(key).items).toHaveLength(1)
    await store.load(key)
    expect(store.getSnapshot(key).items).toHaveLength(0)
  })

  it("applies optimistic updates to every view and ignores late answers", async () => {
    let resolveFirst: (value: Awaited<ReturnType<NotificationCenterLoader>>) => void = () => undefined
    const loader = vi
      .fn<NotificationCenterLoader>()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
      .mockResolvedValueOnce(ok([item("fresh", "2026-10-30T00:00:00Z")]))
    const store = new NotificationCenterStore(loader)
    store.subscribe("org", undefined, BELL, () => undefined)
    await store.load("org")
    resolveFirst(ok([item("stale", "2026-10-01T00:00:00Z")]))
    await flush()
    expect(store.getSnapshot("org").items.map((entry) => entry.id)).toEqual(["fresh"])

    store.update("org", (items) => items.filter((entry) => entry.id !== "fresh"))
    expect(store.getSnapshot("org").items).toEqual([])
  })

  it("refreshes on focus only sources a view asked to, and forgets unused sources", async () => {
    const loader = vi.fn<NotificationCenterLoader>(async () => ok([]))
    const store = new NotificationCenterStore(loader)
    const unsubscribe = store.subscribe("org", undefined, INBOX, () => undefined)
    await flush()
    store.refreshOnFocus()
    expect(loader).toHaveBeenCalledTimes(1)
    store.refreshAll()
    expect(loader).toHaveBeenCalledTimes(2)
    unsubscribe()
    store.refreshAll()
    store.tick()
    expect(loader).toHaveBeenCalledTimes(2)
    expect(store.getSnapshot("org").loaded).toBe(false)
  })

  it("loads nothing for an empty scope list", () => {
    expect(notificationScopeKey([])).toBe("")
    expect(notificationScopeKey(undefined)).toBe("org")
  })
})
