/** @vitest-environment jsdom */

import * as React from "react"
import { act } from "react"
import { createRoot, hydrateRoot, type Root } from "react-dom/client"
import { renderToString } from "react-dom/server"
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
  onMounted?: (element: HTMLDivElement) => void
}>

function Harness({ scopeKey, onMounted }: HarnessProps): React.ReactElement {
  const {
    displayColorPalette,
    displayColorLabels,
    resetPreferences,
    updatePaletteColor,
    updatePaletteLabel,
  } = useScheduleDisplayPreferences(scopeKey)

  return React.createElement(
    "div",
    {
      ref: onMounted,
      "data-palette": JSON.stringify(displayColorPalette),
      "data-labels": JSON.stringify(displayColorLabels),
    },
    React.createElement(
      "button",
      {
        type: "button",
        "data-action": "set-color",
        onClick: () => updatePaletteColor("blue", "#12abef"),
      },
      "Set custom blue"
    ),
    React.createElement(
      "button",
      {
        type: "button",
        "data-action": "set-label",
        onClick: () => updatePaletteLabel("blue", "Custom work"),
      },
      "Set custom label"
    ),
    React.createElement(
      "button",
      {
        type: "button",
        "data-action": "reset",
        onClick: resetPreferences,
      },
      "Reset"
    )
  )
}

function readPalette(host: HTMLDivElement): typeof DEFAULT_DISPLAY_COLOR_PALETTE {
  const value = host.firstElementChild?.getAttribute("data-palette")
  if (!value) throw new Error("Preferences harness did not render")
  return JSON.parse(value) as typeof DEFAULT_DISPLAY_COLOR_PALETTE
}

function readLabels(host: HTMLDivElement): typeof DEFAULT_DISPLAY_COLOR_LABELS {
  const value = host.firstElementChild?.getAttribute("data-labels")
  if (!value) throw new Error("Preferences harness did not render")
  return JSON.parse(value) as typeof DEFAULT_DISPLAY_COLOR_LABELS
}

function button(host: HTMLDivElement, action: string): HTMLButtonElement {
  const element = host.querySelector<HTMLButtonElement>(
    `[data-action="${action}"]`
  )
  if (!element) throw new Error(`Missing ${action} button`)
  return element
}

async function render(
  root: Root,
  host: HTMLDivElement,
  scopeKey: string,
  onMounted?: (element: HTMLDivElement) => void
): Promise<void> {
  await act(async () => {
    root.render(React.createElement(Harness, { scopeKey, onMounted }))
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

  it("fences a scope transition before passive effects can save the prior palette", async () => {
    const projectA = "project-a"
    const projectB = "project-b"
    const projectAPalette = { ...DEFAULT_DISPLAY_COLOR_PALETTE, blue: "#123456" }
    window.localStorage.setItem(schedulePaletteStorageKey(projectA), JSON.stringify(projectAPalette))
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

  it("isolates project and unified palettes while preserving each stored scope", async () => {
    const projectPalette = { ...DEFAULT_DISPLAY_COLOR_PALETTE, blue: "#123456" }
    const unifiedPalette = { ...DEFAULT_DISPLAY_COLOR_PALETTE, blue: "#abcdef" }
    window.localStorage.setItem(
      schedulePaletteStorageKey("project-a"),
      JSON.stringify(projectPalette)
    )
    window.localStorage.setItem(
      schedulePaletteStorageKey("unified"),
      JSON.stringify(unifiedPalette)
    )

    await render(root, host, "project-a")
    expect(readPalette(host)).toEqual(projectPalette)
    await render(root, host, "unified")
    expect(readPalette(host)).toEqual(unifiedPalette)
    await render(root, host, "project-a")
    expect(readPalette(host)).toEqual(projectPalette)
  })

  it("synchronizes independently mounted consumers in the same scope", async () => {
    const secondHost = document.createElement("div")
    document.body.appendChild(secondHost)
    const secondRoot = createRoot(secondHost)

    try {
      await render(root, host, "shared-scope")
      await render(secondRoot, secondHost, "shared-scope")

      await act(async () => {
        button(host, "set-color").click()
        await Promise.resolve()
      })

      expect(readPalette(host).blue).toBe("#12abef")
      expect(readPalette(secondHost).blue).toBe("#12abef")
    } finally {
      await act(async () => secondRoot.unmount())
      secondHost.remove()
    }
  })

  it("does not reset an existing Gantt-like viewport when another consumer updates the palette", async () => {
    const secondHost = document.createElement("div")
    document.body.appendChild(secondHost)
    const secondRoot = createRoot(secondHost)
    const viewportRef: { current: HTMLDivElement | null } = { current: null }

    try {
      await render(root, host, "shared-scope", (element) => {
        viewportRef.current = element
      })
      await render(secondRoot, secondHost, "shared-scope")
      const viewport = viewportRef.current
      if (!viewport) throw new Error("Viewport harness did not mount")
      viewport.scrollTop = 128
      viewport.scrollLeft = 256

      await act(async () => {
        button(secondHost, "set-color").click()
        await Promise.resolve()
      })

      expect(viewport.scrollTop).toBe(128)
      expect(viewport.scrollLeft).toBe(256)
    } finally {
      await act(async () => secondRoot.unmount())
      secondHost.remove()
    }
  })

  it("applies a storage event to all mounted consumers without changing another scope", async () => {
    const secondHost = document.createElement("div")
    document.body.appendChild(secondHost)
    const secondRoot = createRoot(secondHost)
    const nextPalette = { ...DEFAULT_DISPLAY_COLOR_PALETTE, blue: "#123456" }

    try {
      await render(root, host, "project-a")
      await render(secondRoot, secondHost, "project-b")
      window.localStorage.setItem(
        schedulePaletteStorageKey("project-a"),
        JSON.stringify(nextPalette)
      )

      await act(async () => {
        window.dispatchEvent(
          new StorageEvent("storage", {
            key: schedulePaletteStorageKey("project-a"),
            newValue: JSON.stringify(nextPalette),
          })
        )
        await Promise.resolve()
      })

      expect(readPalette(host)).toEqual(nextPalette)
      expect(readPalette(secondHost)).toEqual(DEFAULT_DISPLAY_COLOR_PALETTE)
    } finally {
      await act(async () => secondRoot.unmount())
      secondHost.remove()
    }
  })

  it("resets colors and labels for the active scope", async () => {
    await render(root, host, "project-a")

    await act(async () => {
      button(host, "set-color").click()
      button(host, "set-label").click()
      await Promise.resolve()
    })
    expect(readPalette(host).blue).toBe("#12abef")
    expect(readLabels(host).blue).toBe("Custom work")

    await act(async () => {
      button(host, "reset").click()
      await Promise.resolve()
    })

    expect(readPalette(host)).toEqual(DEFAULT_DISPLAY_COLOR_PALETTE)
    expect(readLabels(host)).toEqual(DEFAULT_DISPLAY_COLOR_LABELS)
    expect(window.localStorage.getItem(schedulePaletteStorageKey("project-a"))).toBe(
      JSON.stringify(DEFAULT_DISPLAY_COLOR_PALETTE)
    )
  })

  it("fails closed for malformed stored values instead of carrying a prior scope", async () => {
    window.localStorage.setItem(
      schedulePaletteStorageKey("project-b"),
      JSON.stringify({ ...DEFAULT_DISPLAY_COLOR_PALETTE, blue: "not-a-color" })
    )
    window.localStorage.setItem(
      schedulePaletteLabelStorageKey("project-b"),
      JSON.stringify(DEFAULT_DISPLAY_COLOR_LABELS)
    )

    await render(root, host, "project-a")
    await render(root, host, "project-b")

    expect(readPalette(host)).toEqual(DEFAULT_DISPLAY_COLOR_PALETTE)
    expect(window.localStorage.getItem(schedulePaletteStorageKey("project-b"))).toBe(
      JSON.stringify(DEFAULT_DISPLAY_COLOR_PALETTE)
    )
  })

  it("keeps the server snapshot stable while loading a legacy partial preference after hydration", async () => {
    const legacyPalette = { blue: "#123456" }
    window.localStorage.setItem(
      schedulePaletteStorageKey("legacy-project"),
      JSON.stringify(legacyPalette)
    )

    const serverMarkup = renderToString(
      React.createElement(Harness, { scopeKey: "legacy-project" })
    )
    const hydratedHost = document.createElement("div")
    hydratedHost.innerHTML = serverMarkup
    document.body.appendChild(hydratedHost)
    const serverPalette = readPalette(hydratedHost)
    const hydratedRoot = hydrateRoot(
      hydratedHost,
      React.createElement(Harness, { scopeKey: "legacy-project" })
    )

    try {
      expect(serverPalette).toEqual(DEFAULT_DISPLAY_COLOR_PALETTE)

      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(readPalette(hydratedHost)).toEqual({
        ...DEFAULT_DISPLAY_COLOR_PALETTE,
        ...legacyPalette,
      })
    } finally {
      await act(async () => hydratedRoot.unmount())
      hydratedHost.remove()
    }
  })
})
