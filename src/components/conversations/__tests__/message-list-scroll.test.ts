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

const realtimeState = vi.hoisted(() => ({
  messages: [] as readonly Record<string, unknown>[],
}))

vi.mock("@/hooks/use-realtime-channel", () => ({
  useRealtimeChannel: () => ({
    newMessages: realtimeState.messages,
    typingUsers: [],
  }),
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
    realtimeState.messages = []
    vi.restoreAllMocks()
  })

  it("shows newest navigation after an empty conversation receives realtime messages and is manually scrolled", async () => {
    const initialMessages: readonly [] = []
    const messageList = React.createElement(MessageList, {
      channelId: "channel-1",
      initialMessages,
      currentUserId: null,
    })

    await act(async () => root.render(messageList))

    realtimeState.messages = Array.from({ length: 30 }, (_, index) => ({
      id: `realtime-${index}`,
      channelId: "channel-1",
      threadId: null,
      content: `Realtime message ${index}`,
      contentHtml: null,
      editedAt: null,
      deletedAt: null,
      isPinned: false,
      replyCount: 0,
      lastReplyAt: null,
      createdAt: `2026-09-09T12:${String(index).padStart(2, "0")}:00.000Z`,
      user: null,
    }))

    await act(async () =>
      root.render(
        React.createElement(MessageList, {
          channelId: "channel-1",
          initialMessages,
          currentUserId: null,
        }),
      ),
    )

    const viewport = host.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    )
    expect(viewport).not.toBeNull()
    if (!viewport) throw new Error("Expected the realtime message viewport")

    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 1_000 },
    })
    viewport.scrollTop = 0

    await act(async () => {
      viewport.dispatchEvent(new Event("scroll"))
    })

    realtimeState.messages = [
      ...realtimeState.messages,
      {
        id: "realtime-30",
        channelId: "channel-1",
        threadId: null,
        content: "Realtime message 30",
        contentHtml: null,
        editedAt: null,
        deletedAt: null,
        isPinned: false,
        replyCount: 0,
        lastReplyAt: null,
        createdAt: "2026-09-09T12:30:00.000Z",
        user: null,
      },
    ]

    await act(async () =>
      root.render(
        React.createElement(MessageList, {
          channelId: "channel-1",
          initialMessages,
          currentUserId: null,
        }),
      ),
    )

    expect(viewport.scrollTop).toBe(0)
    expect(
      Array.from(host.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("Newest messages"),
      ),
    ).toBeDefined()
  })

  it("scrolls only the message viewport when an existing conversation opens", async () => {
    await act(async () => {
      root.render(
        React.createElement(MessageList, {
          channelId: "channel-1",
          currentUserId: null,
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

    await act(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve())
      })
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
