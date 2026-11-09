// @vitest-environment jsdom

import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"

import {
  clearSnapshot,
  discardRestoredText,
  loadSnapshot,
  markTyped,
  restoreTypedText,
  saveSnapshot,
  SNAPSHOT_MAX_AGE_MS,
  snapshotTypedText,
} from "@/lib/deployment/unsaved-text"

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
  writable: true,
})

function field(selector: string): HTMLInputElement | HTMLTextAreaElement {
  const element = document.querySelector(selector)
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
    throw new Error(`missing ${selector}`)
  }
  return element
}

afterEach(() => {
  document.body.innerHTML = ""
  clearSnapshot(window.sessionStorage)
})

describe("unsaved text snapshot", () => {
  it("keeps only typed text fields and skips passwords, hidden and opted-out fields", () => {
    document.body.innerHTML = `
      <input name="title" />
      <input name="untouched" value="server value" />
      <textarea aria-label="Notes"></textarea>
      <input type="password" name="pw" />
      <input type="hidden" name="token" value="x" />
      <input type="checkbox" name="done" />
      <div data-compass-no-restore><input name="secret" /></div>
    `
    for (const selector of ["[name=title]", "textarea", "[name=pw]", "[name=secret]"]) {
      const element = field(selector)
      element.value = `typed ${selector}`
      markTyped(element)
    }

    const snapshot = snapshotTypedText(document, "/dashboard/x", 1_000)
    expect(snapshot?.fields).toEqual([
      { key: "input:text|title#0", value: "typed [name=title]" },
      { key: "textarea|Notes#0", value: "typed textarea" },
    ])
  })

  it("returns nothing when nothing was typed", () => {
    document.body.innerHTML = `<input name="title" value="saved" />`
    expect(snapshotTypedText(document, "/x", 0)).toBeNull()
  })

  it("stores per path and expires old copies", () => {
    const storage = window.sessionStorage
    saveSnapshot(storage, { path: "/a", savedAt: 1_000, fields: [{ key: "k", value: "v" }] })
    expect(loadSnapshot(storage, "/b", 1_000)).toBeNull()
    expect(loadSnapshot(storage, "/a", 2_000)?.fields).toEqual([{ key: "k", value: "v" }])
    expect(loadSnapshot(storage, "/a", 1_000 + SNAPSHOT_MAX_AGE_MS + 1)).toBeNull()
    expect(storage.length).toBe(0)
  })

  it("tells same-named fields apart by position", () => {
    document.body.innerHTML = `<input name="line" /><input name="line" />`
    const inputs = document.querySelectorAll("input")
    inputs[1].value = "second"
    markTyped(inputs[1])
    const snapshot = snapshotTypedText(document, "/x", 0)
    expect(snapshot?.fields).toEqual([{ key: "input:text|line#1", value: "second" }])
  })
})

describe("restoring after reload", () => {
  it("fills a React-controlled input so React state updates, and can discard", async () => {
    const seen: string[] = []
    function Form(): React.ReactElement {
      const [title, setTitle] = React.useState("saved title")
      React.useEffect(() => {
        seen.push(title)
      }, [title])
      return React.createElement("input", {
        name: "title",
        value: title,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => setTitle(event.target.value),
      })
    }
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => root.render(React.createElement(Form)))

    const pending = new Map([["input:text|title#0", "typed before update"]])
    let restored: ReturnType<typeof restoreTypedText> = []
    await act(async () => {
      restored = restoreTypedText(document, pending)
    })
    expect(restored).toHaveLength(1)
    expect(pending.size).toBe(0)
    expect(field("[name=title]").value).toBe("typed before update")
    expect(seen.at(-1)).toBe("typed before update")

    await act(async () => discardRestoredText(restored))
    expect(seen.at(-1)).toBe("saved title")
    await act(async () => root.unmount())
  })

  it("leaves fields that already hold the saved text alone", () => {
    document.body.innerHTML = `<textarea name="note">same</textarea>`
    const pending = new Map([["textarea|note#0", "same"]])
    expect(restoreTypedText(document, pending)).toEqual([])
    expect(pending.size).toBe(0)
  })

  it("waits for fields that are not on the page yet", () => {
    const pending = new Map([["input:text|later#0", "hello"]])
    expect(restoreTypedText(document, pending)).toEqual([])
    expect(pending.size).toBe(1)
    document.body.innerHTML = `<input name="later" />`
    expect(restoreTypedText(document, pending)).toHaveLength(1)
    expect(field("[name=later]").value).toBe("hello")
  })
})
