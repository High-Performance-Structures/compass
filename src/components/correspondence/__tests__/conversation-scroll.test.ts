/** @vitest-environment jsdom */
import * as React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useConversationScroll } from "../use-conversation-scroll"

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true })

type PreviewProps = {
  readonly conversationId: string
  readonly firstId: string | null
  readonly lastId: string | null
  readonly messageCount: number
  readonly ready: boolean
  readonly targetMessageId: string | undefined
}

function Preview(props: PreviewProps): React.ReactElement {
  const navigation = useConversationScroll(props)
  return React.createElement("div", null,
    props.ready ? React.createElement("div", { ref: navigation.viewportRef, "data-viewport": true },
      React.createElement("div", { ref: navigation.contentRef }, "Messages")) : null,
    React.createElement("button", { onClick: navigation.jumpToNewest }, "Newest"),
    React.createElement("span", null, navigation.atNewest ? "At newest" : "Reading history"))
}

describe("correspondence navigation", () => {
  let host: HTMLDivElement
  let root: Root
  let height: number
  const initial: PreviewProps = { conversationId: "a", firstId: "m20", lastId: "m50", messageCount: 30, ready: true, targetMessageId: undefined }
  beforeEach(() => {
    height = 1000
    vi.stubGlobal("ResizeObserver", class { observe(): void {} disconnect(): void {} })
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(200)
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(() => height)
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
  async function render(props: PreviewProps): Promise<HTMLDivElement> {
    await act(async () => root.render(React.createElement(Preview, props)))
    const viewport = host.querySelector<HTMLDivElement>("[data-viewport]")
    if (viewport === null) throw new Error("Missing conversation viewport")
    return viewport
  }
  async function scroll(viewport: HTMLDivElement, top: number): Promise<void> {
    await act(async () => { viewport.scrollTop = top; viewport.dispatchEvent(new Event("scroll")) })
  }
  it("opens at newest and keeps appended messages visible when already at newest", async () => {
    const viewport = await render(initial)
    expect(viewport.scrollTop).toBe(800)
    height = 1200
    await render({ ...initial, lastId: "m51", messageCount: 31 })
    expect(viewport.scrollTop).toBe(1000)
  })
  it("preserves a reader's manual position during polling", async () => {
    const viewport = await render(initial)
    await scroll(viewport, 150)
    height = 1200
    await render({ ...initial, lastId: "m51", messageCount: 31 })
    expect(viewport.scrollTop).toBe(150)
    expect(host.textContent).toContain("Reading history")
  })
  it("uses the latest scroll position when an older page completes", async () => {
    const viewport = await render(initial)
    await scroll(viewport, 50)
    await scroll(viewport, 175)
    height = 1400
    await render({ ...initial, firstId: "m1", messageCount: 50 })
    expect(viewport.scrollTop).toBe(575)
  })
  it("honors a jump to newest while an older page is pending", async () => {
    const viewport = await render(initial)
    await scroll(viewport, 0)
    const button = host.querySelector("button")
    if (button === null) throw new Error("Missing newest control")
    await act(async () => button.click())
    height = 1400
    await render({ ...initial, firstId: "m1", messageCount: 50 })
    expect(viewport.scrollTop).toBe(1200)
    expect(host.textContent).toContain("At newest")
  })
  it("rebinds after asynchronous detail arrives and after an empty conversation gets its first message", async () => {
    await act(async () => root.render(React.createElement(Preview, { ...initial, ready: false })))
    height = 200
    const viewport = await render({ ...initial, firstId: null, lastId: null, messageCount: 0 })
    height = 600
    await render({ ...initial, firstId: "m1", lastId: "m1", messageCount: 1 })
    expect(viewport.scrollTop).toBe(400)
    await scroll(viewport, 10)
    height = 700
    await render({ ...initial, firstId: "m1", lastId: "m2", messageCount: 2 })
    expect(viewport.scrollTop).toBe(10)
  })
  it("keeps explicit message targets authoritative and opens another conversation at newest", async () => {
    const viewport = await render({ ...initial, targetMessageId: "m20" })
    expect(viewport.scrollTop).toBe(0)
    await scroll(viewport, 100)
    await render(initial)
    expect(viewport.scrollTop).toBe(100)
    await render({ ...initial, conversationId: "b" })
    expect(viewport.scrollTop).toBe(800)
  })
})
