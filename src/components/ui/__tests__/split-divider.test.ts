/** @vitest-environment jsdom */
import * as React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { SplitDivider } from "../split-divider"

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true })

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  window.localStorage.clear()
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render(): HTMLElement {
  act(() => root.render(React.createElement("div", { id: "split" }, React.createElement(SplitDivider, { storageKey: "test.split", defaultPercent: 40 }))))
  const divider = host.querySelector<HTMLElement>("[role=separator]")
  if (!divider) throw new Error("divider missing")
  return divider
}

describe("SplitDivider", () => {
  it("sets the list width on its parent from the default", () => {
    const divider = render()
    expect(divider.parentElement?.style.getPropertyValue("--split-list")).toBe("40%")
    expect(divider.getAttribute("aria-valuenow")).toBe("40")
  })

  it("resizes with the arrow keys, remembers the width, and stays within bounds", () => {
    const divider = render()
    act(() => divider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })))
    expect(divider.parentElement?.style.getPropertyValue("--split-list")).toBe("42%")
    expect(window.localStorage.getItem("test.split")).toBe("42")
    for (let i = 0; i < 40; i += 1) act(() => divider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })))
    expect(divider.getAttribute("aria-valuenow")).toBe("20")
  })

  it("restores a remembered width", () => {
    window.localStorage.setItem("test.split", "55")
    const divider = render()
    expect(divider.parentElement?.style.getPropertyValue("--split-list")).toBe("55%")
  })
})
