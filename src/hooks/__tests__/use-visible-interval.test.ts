// @vitest-environment jsdom
import * as React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useVisibleInterval } from "../use-visible-interval"

let visibility: DocumentVisibilityState = "visible"

function Probe({ callback, enabled }: { readonly callback: () => void; readonly enabled: boolean }): null {
  useVisibleInterval(callback, 1_000, enabled)
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

  it("does nothing while disabled", async () => {
    const callback = vi.fn()
    await act(async () => root.render(React.createElement(Probe, { callback, enabled: false })))
    act(() => vi.advanceTimersByTime(5_000))
    expect(callback).not.toHaveBeenCalled()
  })
})
