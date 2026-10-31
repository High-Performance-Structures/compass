// @vitest-environment jsdom
import * as React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useVisibleInterval, type VisibleIntervalOptions } from "../use-visible-interval"

let visibility: DocumentVisibilityState = "visible"

function Probe({ callback, enabled }: { readonly callback: () => void; readonly enabled: boolean }): null {
  useVisibleInterval(callback, 1_000, enabled)
  return null
}

function OptionsProbe({
  callback,
  intervalMs = 1_000,
  options,
}: {
  readonly callback: () => void
  readonly intervalMs?: number
  readonly options: VisibleIntervalOptions
}): null {
  useVisibleInterval(callback, intervalMs, options)
  return null
}

describe("useVisibleInterval", () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    visibility = "visible"
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility })
    container = document.createElement("div")
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const setVisibility = (next: DocumentVisibilityState): void => {
    visibility = next
    document.dispatchEvent(new Event("visibilitychange"))
  }

  it("polls while visible, pauses while hidden, and catches up on return", async () => {
    const callback = vi.fn()
    await act(async () => root.render(React.createElement(Probe, { callback, enabled: true })))
    expect(callback).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(2_000))
    expect(callback).toHaveBeenCalledTimes(3)

    act(() => setVisibility("hidden"))
    act(() => vi.advanceTimersByTime(10_000))
    expect(callback).toHaveBeenCalledTimes(3)

    act(() => setVisibility("visible"))
    expect(callback).toHaveBeenCalledTimes(4)
  })

  it("keeps ticking in a hidden tab only when whileHidden is set", async () => {
    const callback = vi.fn()
    await act(async () =>
      root.render(React.createElement(OptionsProbe, { callback, options: { whileHidden: true } }))
    )
    expect(callback).toHaveBeenCalledTimes(1)
    act(() => setVisibility("hidden"))
    act(() => vi.advanceTimersByTime(3_000))
    expect(callback).toHaveBeenCalledTimes(4)
    act(() => setVisibility("visible"))
    expect(callback).toHaveBeenCalledTimes(4)
  })
  it("does nothing while disabled", async () => {
    const callback = vi.fn()
    await act(async () => root.render(React.createElement(Probe, { callback, enabled: false })))
    act(() => vi.advanceTimersByTime(5_000))
    expect(callback).not.toHaveBeenCalled()
  })

  it("does not refresh on return when no tick was missed, and keeps the schedule", async () => {
    const callback = vi.fn()
    await act(async () => root.render(React.createElement(Probe, { callback, enabled: true })))
    expect(callback).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(300))
    act(() => setVisibility("hidden"))
    act(() => vi.advanceTimersByTime(300))
    act(() => setVisibility("visible"))
    expect(callback).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(399))
    expect(callback).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(1))
    expect(callback).toHaveBeenCalledTimes(2)
  })

  it("refreshes only once on return however many ticks were missed", async () => {
    const callback = vi.fn()
    await act(async () => root.render(React.createElement(Probe, { callback, enabled: true })))
    act(() => setVisibility("hidden"))
    act(() => vi.advanceTimersByTime(60_000))
    act(() => setVisibility("visible"))
    act(() => setVisibility("visible"))
    expect(callback).toHaveBeenCalledTimes(2)
  })

  it("always uses the latest callback without restarting", async () => {
    const first = vi.fn()
    const second = vi.fn()
    await act(async () => root.render(React.createElement(Probe, { callback: first, enabled: true })))
    await act(async () => root.render(React.createElement(Probe, { callback: second, enabled: true })))
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1_000))
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it("honours a configured interval and can skip the immediate run", async () => {
    const callback = vi.fn()
    await act(async () =>
      root.render(React.createElement(OptionsProbe, { callback, intervalMs: 5_000, options: { immediate: false } }))
    )
    expect(callback).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(4_999))
    expect(callback).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it("starts hidden without ticking, then loads on the first visible moment", async () => {
    visibility = "hidden"
    const callback = vi.fn()
    await act(async () => root.render(React.createElement(Probe, { callback, enabled: true })))
    act(() => vi.advanceTimersByTime(5_000))
    expect(callback).not.toHaveBeenCalled()
    act(() => setVisibility("visible"))
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it("refreshes on window focus only when asked", async () => {
    const plain = vi.fn()
    await act(async () => root.render(React.createElement(OptionsProbe, { callback: plain, options: {} })))
    act(() => { window.dispatchEvent(new Event("focus")) })
    expect(plain).toHaveBeenCalledTimes(1)

    const focused = vi.fn()
    await act(async () => root.render(React.createElement(OptionsProbe, { callback: focused, options: { refreshOnFocus: true } })))
    const before = focused.mock.calls.length
    act(() => { window.dispatchEvent(new Event("focus")) })
    expect(focused.mock.calls.length).toBe(before + 1)
  })

  it("stops every timer and listener on unmount", async () => {
    const callback = vi.fn()
    await act(async () => root.render(React.createElement(OptionsProbe, { callback, options: { refreshOnFocus: true } })))
    await act(async () => root.unmount())
    root = createRoot(container)
    act(() => vi.advanceTimersByTime(10_000))
    act(() => setVisibility("hidden"))
    act(() => setVisibility("visible"))
    act(() => { window.dispatchEvent(new Event("focus")) })
    expect(callback).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
