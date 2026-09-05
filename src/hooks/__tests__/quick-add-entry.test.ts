// @vitest-environment jsdom

import * as React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
  writable: true,
})

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}))

import {
  QUICK_ADD_ENTRY_EVENT,
  useQuickAddEntry,
} from "@/hooks/use-quick-add-entry"

let root: Root | null = null
let container: HTMLDivElement | null = null

function setUrl(value: string): void {
  window.history.replaceState({}, "", value)
}

function entryCount(element: HTMLDivElement): number {
  const output = element.querySelector('[data-testid="entry-count"]')
  if (!(output instanceof window.HTMLOutputElement)) {
    throw new Error("Entry count was not rendered")
  }
  return Number(output.value)
}

function draftInput(element: HTMLDivElement): HTMLInputElement {
  const input = element.querySelector('input[aria-label="Draft"]')
  if (!(input instanceof window.HTMLInputElement)) {
    throw new Error("Draft input was not rendered")
  }
  return input
}

function EntryHarness({ action = "rfi" }: { readonly action?: string }): React.ReactElement {
  const [entries, setEntries] = React.useState(0)
  const [draft, setDraft] = React.useState("")

  useQuickAddEntry(action, () => {
    setEntries((current) => current + 1)
  })

  return React.createElement(
    React.Fragment,
    null,
    React.createElement("input", {
      "aria-label": "Draft",
      value: draft,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
        setDraft(event.currentTarget.value),
    }),
    React.createElement("output", { "data-testid": "entry-count" }, entries)
  )
}

async function render(
  element: React.ReactElement
): Promise<HTMLDivElement> {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(element)
    await Promise.resolve()
    await Promise.resolve()
  })

  return container
}

async function updateDraft(
  input: HTMLInputElement,
  value: string
): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  )
  const setValue = descriptor?.set
  if (!setValue) {
    throw new Error("Input value setter is unavailable")
  }

  await act(async () => {
    setValue.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
    await Promise.resolve()
  })
}

afterEach(async () => {
  await act(async () => {
    root?.unmount()
    await Promise.resolve()
  })
  container?.remove()
  root = null
  container = null
  setUrl("/")
  vi.clearAllMocks()
})

describe("useQuickAddEntry", () => {
  it("opens once and consumes only the quick-add marker", async () => {
    setUrl("/dashboard/projects/project-1/rfis?status=open&quickAdd=rfi&item=42#queue")
    const element = await render(React.createElement(EntryHarness))

    expect(entryCount(element)).toBe(1)
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      "/dashboard/projects/project-1/rfis?status=open&item=42#queue"
    )
  })

  it("reopens for the same-page event without discarding draft state", async () => {
    setUrl("/dashboard/projects/project-1/rfis")
    const element = await render(React.createElement(EntryHarness))
    const input = draftInput(element)

    await updateDraft(input, "Clarify roof curb detail")
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(QUICK_ADD_ENTRY_EVENT, { detail: { action: "rfi" } })
      )
      await Promise.resolve()
    })

    expect(entryCount(element)).toBe(1)
    expect(draftInput(element).value).toBe("Clarify roof curb detail")

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(QUICK_ADD_ENTRY_EVENT, { detail: { action: "rfi" } })
      )
      await Promise.resolve()
    })

    expect(entryCount(element)).toBe(2)
    expect(draftInput(element).value).toBe("Clarify roof curb detail")
  })

  it("leaves unrelated quick-add actions alone", async () => {
    setUrl("/dashboard/projects/project-1/rfis?quickAdd=todo&status=open#queue")
    const element = await render(React.createElement(EntryHarness, { action: "rfi" }))

    expect(entryCount(element)).toBe(0)
    expect(`${window.location.search}${window.location.hash}`).toBe(
      "?quickAdd=todo&status=open#queue"
    )
  })

  it("does not open twice when Strict Mode replays effects", async () => {
    setUrl("/dashboard/projects/project-1/rfis?quickAdd=rfi")
    const element = await render(
      React.createElement(
        React.StrictMode,
        null,
        React.createElement(EntryHarness)
      )
    )

    expect(entryCount(element)).toBe(1)
    expect(window.location.search).toBe("")
  })
})
