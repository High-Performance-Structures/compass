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

type HarnessProps = Readonly<{
  scopeKey: string
}>

function Harness({ scopeKey }: HarnessProps): React.ReactElement {
  const { displayColorPalette, displayColorLabels } =
    useScheduleDisplayPreferences(scopeKey)

  return React.createElement("div", {
    "data-palette": JSON.stringify(displayColorPalette),
    "data-labels": JSON.stringify(displayColorLabels),
  })
}

function readPalette(host: HTMLDivElement): typeof DEFAULT_DISPLAY_COLOR_PALETTE {
  const value = host.firstElementChild?.getAttribute("data-palette")
  if (!value) throw new Error("Preferences harness did not render")
  return JSON.parse(value) as typeof DEFAULT_DISPLAY_COLOR_PALETTE
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

  it("fences a scope transition before effects can save the prior palette", async () => {
    const projectA = "project-a"
    const projectB = "project-b"
    const projectAPalette = { ...DEFAULT_DISPLAY_COLOR_PALETTE, blue: "#123456" }
    window.localStorage.setItem(
      schedulePaletteStorageKey(projectA),
      JSON.stringify(projectAPalette)
    )
    window.localStorage.setItem(
      schedulePaletteLabelStorageKey(projectA),
      JSON.stringify(DEFAULT_DISPLAY_COLOR_LABELS)
    )

    await render(root, host, projectA)
    expect(readPalette(host)).toEqual(projectAPalette)

    await render(root, host, projectB)

    expect(readPalette(host)).toEqual(DEFAULT_DISPLAY_COLOR_PALETTE)
    expect(window.localStorage.getItem(schedulePaletteStorageKey(projectB))).toBe(
      JSON.stringify(DEFAULT_DISPLAY_COLOR_PALETTE)
    )
    expect(window.localStorage.getItem(schedulePaletteStorageKey(projectA))).toBe(
      JSON.stringify(projectAPalette)
    )
  })
})
