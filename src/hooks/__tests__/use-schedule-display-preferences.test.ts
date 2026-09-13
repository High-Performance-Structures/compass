/** @vitest-environment jsdom */

import * as React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  DEFAULT_DISPLAY_COLOR_LABELS,
  DEFAULT_DISPLAY_COLOR_PALETTE,
  schedulePaletteLabelStorageKey,
  schedulePaletteStorageKey,
} from "@/lib/schedule/appearance"
import { useScheduleDisplayPreferences } from "@/hooks/use-schedule-display-preferences"

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
})

type HarnessProps = Readonly<{ scopeKey: string }>

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length(): number {
    return this.values.size
  }

  clear(): void {
    this.values.clear()
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function Harness({ scopeKey }: HarnessProps): React.ReactElement {
  const {
    displayColorLabels,
    displayColorPalette,
    updatePaletteColor,
  } = useScheduleDisplayPreferences(scopeKey)

  return React.createElement("div", null,
    React.createElement(
      "output",
      {
        "data-palette": JSON.stringify(displayColorPalette),
        "data-labels": JSON.stringify(displayColorLabels),
      }
    ),
    React.createElement(
      "button",
      {
        type: "button",
        onClick: () => updatePaletteColor("blue", "#12abef"),
      },
      "Set custom blue"
    )
  )
}

function readRenderedPreferences(host: HTMLDivElement): {
  readonly palette: typeof DEFAULT_DISPLAY_COLOR_PALETTE
  readonly labels: typeof DEFAULT_DISPLAY_COLOR_LABELS
} {
  const output = host.querySelector("output")
  if (!output) throw new Error("Preferences harness did not render")
  return {
    palette: JSON.parse(output.dataset.palette ?? "null") as typeof DEFAULT_DISPLAY_COLOR_PALETTE,
    labels: JSON.parse(output.dataset.labels ?? "null") as typeof DEFAULT_DISPLAY_COLOR_LABELS,
  }
}

async function render(
  root: Root,
  host: HTMLDivElement,
  scopeKey: string
): Promise<void> {
  await act(async () => {
    root.render(React.createElement(Harness, { scopeKey }))
    await Promise.resolve()
    await Promise.resolve()
  })
  if (!host.querySelector("output")) throw new Error("Preferences harness did not mount")
}

describe("useScheduleDisplayPreferences", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: new MemoryStorage(),
    })
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    window.localStorage.clear()
  })

  it("resets to defaults before saving when navigating to a scope without stored preferences", async () => {
    const projectA = "project-a"
    const projectB = "project-b"
    const projectAPalette = { ...DEFAULT_DISPLAY_COLOR_PALETTE, blue: "#123456" }
    const projectALabels = { ...DEFAULT_DISPLAY_COLOR_LABELS, blue: "Project A work" }
    window.localStorage.setItem(schedulePaletteStorageKey(projectA), JSON.stringify(projectAPalette))
    window.localStorage.setItem(schedulePaletteLabelStorageKey(projectA), JSON.stringify(projectALabels))

    await render(root, host, projectA)
    expect(readRenderedPreferences(host)).toEqual({
      palette: projectAPalette,
      labels: projectALabels,
    })

    await render(root, host, projectB)

    expect(readRenderedPreferences(host)).toEqual({
      palette: DEFAULT_DISPLAY_COLOR_PALETTE,
      labels: DEFAULT_DISPLAY_COLOR_LABELS,
    })
    expect(window.localStorage.getItem(schedulePaletteStorageKey(projectB))).toBe(
      JSON.stringify(DEFAULT_DISPLAY_COLOR_PALETTE)
    )
    expect(window.localStorage.getItem(schedulePaletteLabelStorageKey(projectB))).toBe(
      JSON.stringify(DEFAULT_DISPLAY_COLOR_LABELS)
    )
  })

  it("fails closed for malformed new-scope values instead of carrying the prior scope", async () => {
    const projectA = "project-a"
    const projectB = "project-b"
    window.localStorage.setItem(
      schedulePaletteStorageKey(projectA),
      JSON.stringify({ ...DEFAULT_DISPLAY_COLOR_PALETTE, green: "#654321" })
    )
    window.localStorage.setItem(
      schedulePaletteLabelStorageKey(projectA),
      JSON.stringify({ ...DEFAULT_DISPLAY_COLOR_LABELS, green: "Project A field work" })
    )
    window.localStorage.setItem(schedulePaletteStorageKey(projectB), "not-json")
    window.localStorage.setItem(schedulePaletteLabelStorageKey(projectB), JSON.stringify({ green: "" }))

    await render(root, host, projectA)
    await render(root, host, projectB)

    expect(readRenderedPreferences(host)).toEqual({
      palette: DEFAULT_DISPLAY_COLOR_PALETTE,
      labels: DEFAULT_DISPLAY_COLOR_LABELS,
    })
    expect(window.localStorage.getItem(schedulePaletteStorageKey(projectB))).toBe(
      JSON.stringify(DEFAULT_DISPLAY_COLOR_PALETTE)
    )
    expect(window.localStorage.getItem(schedulePaletteLabelStorageKey(projectB))).toBe(
      JSON.stringify(DEFAULT_DISPLAY_COLOR_LABELS)
    )
  })

  it("loads valid existing preferences across repeated scope navigation", async () => {
    const projectA = "project-a"
    const projectB = "project-b"
    const projectAPalette = { ...DEFAULT_DISPLAY_COLOR_PALETTE, blue: "#123456" }
    const projectBPalette = { ...DEFAULT_DISPLAY_COLOR_PALETTE, blue: "#abcdef" }
    const projectALabels = { ...DEFAULT_DISPLAY_COLOR_LABELS, blue: "Project A work" }
    const projectBLabels = { ...DEFAULT_DISPLAY_COLOR_LABELS, blue: "Project B work" }
    window.localStorage.setItem(schedulePaletteStorageKey(projectA), JSON.stringify(projectAPalette))
    window.localStorage.setItem(schedulePaletteLabelStorageKey(projectA), JSON.stringify(projectALabels))
    window.localStorage.setItem(schedulePaletteStorageKey(projectB), JSON.stringify(projectBPalette))
    window.localStorage.setItem(schedulePaletteLabelStorageKey(projectB), JSON.stringify(projectBLabels))

    await render(root, host, projectA)
    await render(root, host, projectB)
    expect(readRenderedPreferences(host)).toEqual({
      palette: projectBPalette,
      labels: projectBLabels,
    })

    await render(root, host, projectA)
    expect(readRenderedPreferences(host)).toEqual({
      palette: projectAPalette,
      labels: projectALabels,
    })
    await render(root, host, projectB)
    expect(readRenderedPreferences(host)).toEqual({
      palette: projectBPalette,
      labels: projectBLabels,
    })
  })

  it("saves and reloads a custom palette color without changing its scope", async () => {
    const projectA = "project-a"
    await render(root, host, projectA)

    const button = host.querySelector("button")
    if (!button) throw new Error("Custom color control did not render")
    await act(async () => {
      button.click()
      await Promise.resolve()
    })

    const savedPalette = JSON.parse(
      window.localStorage.getItem(schedulePaletteStorageKey(projectA)) ?? "null"
    )
    expect(savedPalette.blue).toBe("#12abef")

    await render(root, host, "project-b")
    await render(root, host, projectA)
    expect(readRenderedPreferences(host).palette.blue).toBe("#12abef")
  })
})
