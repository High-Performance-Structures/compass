// @vitest-environment jsdom
import * as React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useGanttPalette, type GanttPaletteState } from "../schedule-gantt/use-gantt-palette"
import { DEFAULT_DISPLAY_COLOR_PALETTE, schedulePaletteStorageKey } from "@/lib/schedule/appearance"

// Switching jobs keeps the schedule page mounted; one job's colors must never land on another.
describe("useGanttPalette across schedules", () => {
  let root: Root
  let container: HTMLDivElement
  let latest: GanttPaletteState | null = null

  function Probe({ scope }: { readonly scope: string }): null {
    latest = useGanttPalette(scope)
    return null
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    window.localStorage.clear()
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it("starts a schedule without saved colors from the defaults and leaves its storage alone", () => {
    window.localStorage.setItem(
      schedulePaletteStorageKey("job-a"),
      JSON.stringify({ ...DEFAULT_DISPLAY_COLOR_PALETTE, blue: "#000000" })
    )

    act(() => root.render(React.createElement(Probe, { scope: "job-a" })))
    expect(latest?.displayColorPalette.blue).toBe("#000000")

    act(() => root.render(React.createElement(Probe, { scope: "job-b" })))
    expect(latest?.displayColorPalette.blue).toBe(DEFAULT_DISPLAY_COLOR_PALETTE.blue)
    const savedB = window.localStorage.getItem(schedulePaletteStorageKey("job-b"))
    expect(savedB === null || !savedB.includes("#000000")).toBe(true)
    expect(window.localStorage.getItem(schedulePaletteStorageKey("job-a"))).toContain("#000000")
  })

  it("saves a change under the schedule being edited", () => {
    act(() => root.render(React.createElement(Probe, { scope: "job-a" })))
    act(() => latest?.updatePaletteColor("blue", "#123456"))
    expect(window.localStorage.getItem(schedulePaletteStorageKey("job-a"))).toContain("#123456")

    act(() => root.render(React.createElement(Probe, { scope: "job-b" })))
    expect(window.localStorage.getItem(schedulePaletteStorageKey("job-b")) ?? "").not.toContain("#123456")
  })
})
