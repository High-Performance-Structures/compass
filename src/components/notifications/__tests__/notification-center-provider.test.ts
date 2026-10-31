// @vitest-environment jsdom
import * as React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { NotificationCenterLoader } from "@/lib/notifications/notification-center-store"

const mocks = vi.hoisted(() => ({ center: vi.fn() }))
vi.mock("@/app/actions/notifications", () => ({
  getNotificationCenter: mocks.center,
  markNotificationRead: vi.fn(async () => ({ success: true })),
  setNotificationsDismissed: vi.fn(async () => ({ success: true })),
}))

import { NotificationCenterProvider, useNotificationCenter } from "../notification-center-provider"
import { NOTIFICATIONS_CHANGED_EVENT } from "@/lib/notifications/client-events"

let visibility: DocumentVisibilityState = "visible"
const seen: Record<string, number> = {}

function View({ name, intervalMs }: { readonly name: string; readonly intervalMs: number }): null {
  const center = useNotificationCenter(undefined, { enabled: true, intervalMs })
  seen[name] = center.items.length
  return null
}

const result = { success: true, data: { unreadCount: 0, items: [] } }

describe("NotificationCenterProvider", () => {
  let root: Root
  let loader: ReturnType<typeof vi.fn<NotificationCenterLoader>>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    visibility = "visible"
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility })
    loader = vi.fn<NotificationCenterLoader>(async () => ({ success: true, data: { unreadCount: 0, items: [] } }))
    mocks.center.mockReset()
    mocks.center.mockResolvedValue(result)
    root = createRoot(document.createElement("div"))
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const renderTree = async (): Promise<void> => {
    await act(async () =>
      root.render(
        React.createElement(
          NotificationCenterProvider,
          { loader },
          React.createElement(View, { name: "bell-desktop", intervalMs: 15_000 }),
          React.createElement(View, { name: "bell-mobile", intervalMs: 15_000 }),
          React.createElement(View, { name: "map", intervalMs: 30_000 }),
        ),
      ),
    )
  }

  it("loads once for every view of the same scope and polls at the fastest view's pace", async () => {
    await renderTree()
    expect(loader).toHaveBeenCalledTimes(1)
    await act(async () => vi.advanceTimersByTimeAsync(15_000))
    expect(loader).toHaveBeenCalledTimes(2)
    await act(async () => vi.advanceTimersByTimeAsync(15_000))
    expect(loader).toHaveBeenCalledTimes(3)
    expect(mocks.center).not.toHaveBeenCalled()
  })

  it("stops polling in a hidden tab and catches up once on return", async () => {
    await renderTree()
    await act(async () => {
      visibility = "hidden"
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await act(async () => vi.advanceTimersByTimeAsync(120_000))
    expect(loader).toHaveBeenCalledTimes(1)
    await act(async () => {
      visibility = "visible"
      document.dispatchEvent(new Event("visibilitychange"))
    })
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it("refreshes every view once when notifications change", async () => {
    await renderTree()
    await act(async () => {
      window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT))
    })
    expect(loader).toHaveBeenCalledTimes(2)
  })
})
