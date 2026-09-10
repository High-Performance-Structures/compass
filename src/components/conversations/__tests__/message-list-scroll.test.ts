/** @vitest-environment jsdom */

import * as React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { MessageList } from "@/components/conversations/message-list"

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
})

vi.mock("@/app/actions/chat-messages", () => ({
  getMessages: vi.fn(),
}))

vi.mock("@/hooks/use-realtime-channel", () => ({
  useRealtimeChannel: () => ({ newMessages: [], typingUsers: [] }),
}))

vi.mock("@/components/conversations/message-item", () => ({
  MessageItem: () => React.createElement("div", null, "Message"),
}))

vi.mock("@/components/conversations/typing-indicator", () => ({
  TypingIndicator: () => null,
}))

describe("MessageList scrolling", () => {
  let host: HTMLDivElement
  let root: Root
  let scrollTo: ReturnType<typeof vi.fn>

  beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    scrollTo = vi.fn()
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: scrollTo,
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  it("scrolls only the message viewport when an existing conversation opens", async () => {
    await act(async () => {
      root.render(
        React.createElement(MessageList, {
          channelId: "channel-1",
          initialMessages: [
            {
              id: "message-1",
              channelId: "channel-1",
              threadId: null,
              content: "Existing message",
              contentHtml: null,
              editedAt: null,
              deletedAt: null,
              isPinned: false,
              replyCount: 0,
              lastReplyAt: null,
              createdAt: "2026-09-09T12:00:00.000Z",
              user: null,
            },
          ],
        })
      )
    })

    const viewport = document.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]'
    )
    expect(viewport).not.toBeNull()
    expect(scrollTo).toHaveBeenCalledOnce()
    expect(scrollTo.mock.contexts[0]).toBe(viewport)
    expect(scrollTo).toHaveBeenCalledWith({
      top: viewport?.scrollHeight ?? 0,
      behavior: "smooth",
    })
  })
})
