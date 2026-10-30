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
  markChannelRead: vi.fn().mockResolvedValue({ success: true }),
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
  MessageItem: ({ message }: { readonly message: { readonly id: string } }) =>
    React.createElement("div", { "data-message-id": message.id }, "Message"),
}))

vi.mock("@/components/conversations/typing-indicator", () => ({
  TypingIndicator: () => null,
}))

describe("MessageList scrolling", () => {
  let host: HTMLDivElement
  let root: Root
  let scrollTo: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // Auto scrollbars observe overflow on mount; jsdom has no ResizeObserver.
    vi.stubGlobal("ResizeObserver", class {
      readonly observe = vi.fn()
      readonly unobserve = vi.fn()
      readonly disconnect = vi.fn()
    })
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
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("requests timestamp-tied older history with the oldest message ID", async () => {
    const { getMessages } = await import("@/app/actions/chat-messages")
    const createdAt = "2026-07-29T21:53:00.000Z"
    const message = (id: string) => ({ id, channelId: "archive", threadId: null, content: id, contentHtml: null,
      editedAt: null, deletedAt: null, isPinned: false, replyCount: 0, lastReplyAt: null, createdAt, user: null })
    vi.mocked(getMessages).mockReset().mockResolvedValueOnce({ success: true, data: [{ ...message("message-099"), attachments: [], reactions: [] }] })
    const initialMessages = Array.from({ length: 50 }, (_, i) => message(`message-${149 - i}`))
    await act(async () => root.render(React.createElement(MessageList, { channelId: "archive", initialMessages, currentUserId: null })))
    const older = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Load older messages")
    if (older === undefined) throw new Error("Missing older history control")
    await act(async () => older.click())
    expect(getMessages).toHaveBeenCalledWith("archive", { limit: 50, cursor: { createdAt, id: "message-100" } })
    expect(host.querySelector('[data-message-id="message-099"]')).not.toBeNull()
  })

  it("keeps unseen realtime arrivals unread until the reader returns to newest", async () => {
    const { markChannelRead } = await import("@/app/actions/chat-messages")
    vi.mocked(markChannelRead).mockClear()
    vi.useFakeTimers()
    const message = {
      id: "read-message-1", channelId: "channel-1", threadId: null,
      content: "Newest", contentHtml: null, editedAt: null, deletedAt: null,
      isPinned: false, replyCount: 0, lastReplyAt: null,
      createdAt: "2026-10-12T06:00:00.000Z", user: null,
    }
    const initialMessages = [message]
    await act(async () => root.render(React.createElement(MessageList, { channelId: "channel-1", initialMessages, currentUserId: null })))
    const viewport = host.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')
    if (viewport === null) throw new Error("Missing message viewport")
    Object.defineProperties(viewport, { clientHeight: { configurable: true, value: 200 }, scrollHeight: { configurable: true, value: 1000 } })
    await act(async () => { viewport.scrollTop = 100; viewport.dispatchEvent(new Event("scroll")) })
    realtimeState.messages = [{ ...message, id: "read-message-2", createdAt: "2026-10-12T06:01:00.000Z" }]
    await act(async () => root.render(React.createElement(MessageList, { channelId: "channel-1", initialMessages, currentUserId: null })))
    await act(async () => vi.advanceTimersByTime(900))
    expect(markChannelRead).not.toHaveBeenCalled()
    const jump = host.querySelector<HTMLButtonElement>('[aria-label="Jump to newest messages"]')
    if (jump === null) throw new Error("Missing newest control")
    await act(async () => jump.click())
    await act(async () => vi.advanceTimersByTime(900))
    expect(markChannelRead).toHaveBeenCalledWith("channel-1", "read-message-2")
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

  it("does not override a manual scroll before the initial newest frame runs", async () => {
    const pendingFrames: FrameRequestCallback[] = []
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      pendingFrames.push(callback)
      return pendingFrames.length
    })

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
        }),
      )
    })

    const viewport = host.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    )
    expect(viewport).not.toBeNull()
    if (!viewport) throw new Error("Expected the initial message viewport")

    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 1_000 },
    })
    viewport.scrollTop = 0

    await act(async () => {
      viewport.dispatchEvent(new Event("scroll"))
    })
    expect(pendingFrames).toHaveLength(1)

    await act(async () => {
      pendingFrames.shift()?.(0)
    })

    expect(viewport.scrollTop).toBe(0)
    expect(scrollTo).not.toHaveBeenCalled()
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

  it("preserves a manual upward scroll when server messages refresh", async () => {
    const initialMessages = [
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
    ]

    await act(async () => {
      root.render(
        React.createElement(MessageList, {
          channelId: "channel-1",
          currentUserId: null,
          initialMessages,
        }),
      )
    })

    const viewport = host.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    )
    expect(viewport).not.toBeNull()
    if (!viewport) throw new Error("Expected the refreshed message viewport")

    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 1_000 },
    })

    await act(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve())
      })
    })

    viewport.scrollTop = 0
    await act(async () => {
      viewport.dispatchEvent(new Event("scroll"))
    })
    scrollTo.mockClear()

    await act(async () => {
      root.render(
        React.createElement(MessageList, {
          channelId: "channel-1",
          currentUserId: null,
          initialMessages: [
            {
              ...initialMessages[0],
              content: "Refreshed message",
            },
          ],
        }),
      )
    })

    await act(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve())
      })
    })

    expect(viewport.scrollTop).toBe(0)
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it("opens a directly selected channel at its newest edge after a prior channel was scrolled up", async () => {
    const message = (id: string, channelId: string) => ({
      id,
      channelId,
      threadId: null,
      content: id,
      contentHtml: null,
      editedAt: null,
      deletedAt: null,
      isPinned: false,
      replyCount: 0,
      lastReplyAt: null,
      createdAt: "2026-09-09T12:00:00.000Z",
      user: null,
    })

    await act(async () => {
      root.render(
        React.createElement(MessageList, {
          channelId: "channel-1",
          currentUserId: null,
          initialMessages: [message("message-1", "channel-1")],
        }),
      )
    })

    const viewport = host.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    )
    expect(viewport).not.toBeNull()
    if (!viewport) throw new Error("Expected the direct-navigation viewport")

    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 1_000 },
    })
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })

    viewport.scrollTop = 0
    await act(async () => viewport.dispatchEvent(new Event("scroll")))
    scrollTo.mockClear()

    await act(async () => {
      root.render(
        React.createElement(MessageList, {
          channelId: "channel-2",
          currentUserId: null,
          initialMessages: [message("message-2", "channel-2")],
        }),
      )
    })
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })

    expect(scrollTo).toHaveBeenCalledWith({ top: 900, behavior: "smooth" })
  })

  it("does not carry realtime messages from a previous channel into direct navigation", async () => {
    const message = (id: string, channelId: string) => ({
      id,
      channelId,
      threadId: null,
      content: id,
      contentHtml: null,
      editedAt: null,
      deletedAt: null,
      isPinned: false,
      replyCount: 0,
      lastReplyAt: null,
      createdAt: "2026-09-09T12:00:00.000Z",
      user: null,
    })
    const channelOneMessages = [message("message-1", "channel-1")]
    const channelTwoMessages = [message("message-2", "channel-2")]

    await act(async () => {
      root.render(
        React.createElement(MessageList, {
          channelId: "channel-1",
          currentUserId: null,
          initialMessages: channelOneMessages,
        }),
      )
    })

    realtimeState.messages = [message("realtime-1", "channel-1")]
    await act(async () => {
      root.render(
        React.createElement(MessageList, {
          channelId: "channel-1",
          currentUserId: null,
          initialMessages: channelOneMessages,
        }),
      )
    })
    expect(host.querySelector('[data-message-id="realtime-1"]')).not.toBeNull()

    realtimeState.messages = [
      ...realtimeState.messages,
      message("realtime-2", "channel-2"),
    ]
    await act(async () => {
      root.render(
        React.createElement(MessageList, {
          channelId: "channel-2",
          currentUserId: null,
          initialMessages: channelTwoMessages,
        }),
      )
    })
    expect(host.querySelector('[data-message-id="realtime-2"]')).not.toBeNull()

    realtimeState.messages = [
      ...realtimeState.messages,
      message("realtime-3", "channel-2"),
    ]
    await act(async () => {
      root.render(
        React.createElement(MessageList, {
          channelId: "channel-2",
          currentUserId: null,
          initialMessages: channelTwoMessages,
        }),
      )
    })

    expect(host.querySelector('[data-message-id="realtime-1"]')).toBeNull()
    expect(host.querySelector('[data-message-id="realtime-3"]')).not.toBeNull()
  })
})
