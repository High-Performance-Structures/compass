/** @vitest-environment jsdom */

import * as React from "react"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { getConversationPanelData } from "@/app/actions/conversation-panel"
import { listChannels } from "@/app/actions/conversations"
import { ConversationPanelProvider, useConversationPanel } from "../conversation-panel-provider"
import { ConversationPanelShell } from "../conversation-panel-shell"

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
})

type PanelResult = Awaited<ReturnType<typeof getConversationPanelData>>
type PanelData = Extract<PanelResult, { readonly success: true }>["data"]
type Deferred<Value> = {
  readonly promise: Promise<Value>
  readonly resolve: (value: Value) => void
}

function createDeferred<Value>(): Deferred<Value> {
  let resolvePromise: ((value: Value) => void) | undefined
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve
  })
  if (!resolvePromise) throw new Error("Deferred promise was not initialized")
  return { promise, resolve: resolvePromise }
}

function panelData(channelId: string, name: string): PanelData {
  return {
    channel: {
      id: channelId,
      name,
      description: null,
      organizationId: "organization-1",
      projectId: null,
      archivedAt: null,
    },
    currentUserId: "user-1",
    messages: [],
    projectRecipients: [],
  }
}

function PanelControls() {
  const { open } = useConversationPanel()
  return createElement(
    React.Fragment,
    null,
    createElement(
      "button",
      { type: "button", "data-testid": "open-list", onClick: () => open(null) },
      "Open conversations",
    ),
    createElement(
      "button",
      { type: "button", "data-testid": "open-alpha", onClick: () => open("channel-alpha") },
      "Open Alpha",
    ),
    createElement(
      "button",
      { type: "button", "data-testid": "open-beta", onClick: () => open("channel-beta") },
      "Open Beta",
    ),
  )
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock("@/app/actions/conversation-panel", () => ({
  getConversationPanelData: vi.fn(),
}))

vi.mock("@/app/actions/conversations", () => ({
  listChannels: vi.fn(async () => ({ success: true, data: [] })),
}))

vi.mock("@/contexts/conversations-context", () => ({
  ConversationsProvider: ({ children }: { readonly children: React.ReactNode }) =>
    createElement(React.Fragment, null, children),
}))

vi.mock("@/components/conversations/message-list", () => ({
  MessageList: ({ channelId }: { readonly channelId: string }) =>
    createElement("div", { "data-testid": "message-list" }, channelId),
}))

vi.mock("@/components/conversations/message-composer", () => ({
  MessageComposer: ({ channelId }: { readonly channelId: string }) =>
    createElement("div", { "data-testid": "message-composer" }, channelId),
}))

vi.mock("@/components/conversations/direct-message-dialog", () => ({
  DirectMessagePicker: ({ onStarted }: { readonly onStarted: (channelId: string) => void }) =>
    createElement("button", { type: "button", onClick: () => onStarted("channel-new") }, "Start conversation"),
}))

describe("ConversationPanelShell", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })

  it("starts a new conversation from an empty drawer and refreshes its list", async () => {
    vi.mocked(getConversationPanelData).mockResolvedValue({ success: true, data: panelData("channel-new", "New conversation") })

    await act(async () => {
      root.render(createElement(ConversationPanelProvider, null,
        createElement(PanelControls), createElement(ConversationPanelShell)))
    })
    await act(async () => document.querySelector<HTMLButtonElement>("[data-testid='open-list']")?.click())
    expect(host.textContent).toContain("No conversations are available.")
    const newConversation = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("New conversation"))
    expect(newConversation).toBeDefined()

    await act(async () => newConversation?.click())
    expect(host.querySelector("h2")?.textContent).toBe("New direct message")
    const startConversation = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Start conversation")
    await act(async () => startConversation?.click())

    expect(host.querySelector("h2")?.textContent).toBe("# New conversation")
    expect(getConversationPanelData).toHaveBeenCalledWith("channel-new")
    expect(listChannels).toHaveBeenCalledTimes(2)
    // Starting another conversation remains available while one is open.
    expect(Array.from(host.querySelectorAll("button")).some((button) => button.textContent?.includes("New conversation"))).toBe(true)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  it("keeps the selected channel when loads resolve out of order", async () => {
    const alpha = createDeferred<PanelResult>()
    const beta = createDeferred<PanelResult>()
    vi.mocked(getConversationPanelData).mockImplementation((channelId) => {
      if (channelId === "channel-alpha") return alpha.promise
      if (channelId === "channel-beta") return beta.promise
      throw new Error(`Unexpected channel: ${channelId}`)
    })

    await act(async () => {
      root.render(
        createElement(
          ConversationPanelProvider,
          null,
          createElement(PanelControls),
          createElement(ConversationPanelShell),
        ),
      )
    })

    const openAlpha = document.querySelector<HTMLButtonElement>("[data-testid='open-alpha']")
    const openBeta = document.querySelector<HTMLButtonElement>("[data-testid='open-beta']")
    expect(openAlpha).not.toBeNull()
    expect(openBeta).not.toBeNull()

    await act(async () => {
      openAlpha?.click()
      await Promise.resolve()
    })
    await act(async () => {
      openBeta?.click()
      await Promise.resolve()
    })

    await act(async () => beta.resolve({ success: true, data: panelData("channel-beta", "Beta") }))
    expect(document.querySelector("h2")?.textContent).toBe("# Beta")

    await act(async () => alpha.resolve({ success: true, data: panelData("channel-alpha", "Alpha") }))
    expect(document.querySelector("h2")?.textContent).toBe("# Beta")
    expect(document.querySelector<HTMLElement>("[data-testid='message-list']")?.textContent).toBe(
      "channel-beta",
    )
  })
})
