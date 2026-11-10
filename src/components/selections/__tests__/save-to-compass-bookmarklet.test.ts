// @vitest-environment jsdom

import * as React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"

import { SaveToCompassBookmarklet } from "@/components/selections/save-to-compass-bookmarklet"

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true, writable: true })

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe("SaveToCompassBookmarklet", () => {
  it("renders a draggable javascript: link built from this page's origin", () => {
    container = document.createElement("div")
    document.body.append(container)
    const mounted = createRoot(container)
    root = mounted
    act(() => mounted.render(React.createElement(SaveToCompassBookmarklet)))
    const link = container.querySelector("a")
    expect(link?.textContent).toContain("Save to Compass")
    expect(link?.getAttribute("draggable")).toBe("true")
    const href = link?.getAttribute("href") ?? ""
    expect(href.startsWith("javascript:")).toBe(true)
    expect(href).toContain(JSON.stringify(`${window.location.origin}/save-to-compass`))
    expect(container.textContent).toContain("Drag this button to your bookmarks bar.")
  })

  it("compact: just the draggable button, with the instruction as its tooltip", () => {
    container = document.createElement("div")
    document.body.append(container)
    const mounted = createRoot(container)
    root = mounted
    act(() => mounted.render(React.createElement(SaveToCompassBookmarklet, { variant: "compact" })))
    const link = container.querySelector("a")
    expect(link?.getAttribute("draggable")).toBe("true")
    expect(link?.getAttribute("href")?.startsWith("javascript:")).toBe(true)
    expect(link?.getAttribute("title")).toContain("Drag this button to your bookmarks bar.")
    expect(container.querySelector("h3")).toBeNull()
    expect(container.textContent).toBe("Save to Compass")
  })
})
