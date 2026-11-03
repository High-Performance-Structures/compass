/** @vitest-environment jsdom */
import * as React from "react"
import { act } from "react"
import { renderToString } from "react-dom/server"
import { hydrateRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MessageList } from "../message-list"
import { conversationDayKey, conversationDayLabel, conversationTimeLabel } from "@/lib/conversations/message-dates"

vi.mock("@/app/actions/chat-messages", () => ({
  getMessages: vi.fn(), markChannelRead: vi.fn().mockResolvedValue({ success: true }),
  addReaction: vi.fn(), removeReaction: vi.fn(), deleteMessage: vi.fn(),
}))
const realtime = vi.hoisted(() => ({ messages: [] }))
vi.mock("@/hooks/use-realtime-channel", () => ({ useRealtimeChannel: () => ({ newMessages: realtime.messages, typingUsers: [] }) }))
vi.mock("@/contexts/conversations-context", () => ({ useConversations: () => ({ openThread: vi.fn() }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true })
function message(createdAt: string, lastReplyAt: string | null = null) {
  return { id: "message", channelId: "archive", threadId: null, content: "Archived source text", contentHtml: null,
    editedAt: null, deletedAt: null, isPinned: false, replyCount: lastReplyAt ? 1 : 0,
    lastReplyAt, createdAt, user: null }
}

describe("conversation date hydration", () => {
  let host: HTMLDivElement
  let root: Root | null = null
  beforeEach(() => {
    host = document.createElement("div"); document.body.appendChild(host)
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() })
    const resolved = Intl.DateTimeFormat.prototype.resolvedOptions
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function (this: Intl.DateTimeFormat): Intl.ResolvedDateTimeFormatOptions {
      return { ...resolved.call(this), timeZone: "America/Denver" }
    })
  })
  afterEach(async () => {
    const current = root
    if (current !== null) await act(async () => current.unmount())
    root = null; document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()
  })

  it("hydrates UTC server labels and day groups without mismatch, then displays the viewer's original local day", async () => {
    const iso = "2026-09-16T04:30:00.000Z"
    expect(conversationDayKey(iso, "UTC")).toBe("2026-09-16")
    expect(conversationDayKey(iso, "America/Denver")).toBe("2026-09-15")
    expect(conversationDayLabel("2026-09-15")).toBe("September 15, 2026")
    expect(conversationTimeLabel(iso, "America/Denver")).toBe("Sep 15 at 10:30 PM")
    const element = React.createElement(MessageList, { channelId: "archive", initialMessages: [message(iso)], currentUserId: null })
    host.innerHTML = renderToString(element)
    expect(host.textContent).toContain("September 16, 2026")
    expect(host.textContent).toContain("Sep 16 at 4:30 AM")
    const errors: unknown[] = []
    await act(async () => { root = hydrateRoot(host, element, { onRecoverableError: (error) => errors.push(error) }) })
    expect(errors).toEqual([])
    expect(host.textContent).toContain("September 15, 2026")
    expect(host.textContent).toContain("Sep 15 at 10:30 PM")
    expect(host.textContent).not.toContain("September 16, 2026")
  })

  it("keeps relative message and reply clocks out of the server/first-client render", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-10-29T12:00:00.000Z"))
    const element = React.createElement(MessageList, { channelId: "archive", initialMessages: [message("2026-10-29T11:59:30.000Z", "2026-10-29T11:59:45.000Z")], currentUserId: null })
    host.innerHTML = renderToString(element)
    expect(host.textContent).toContain("Oct 29 at 11:59 AM")
    expect(host.textContent).not.toContain("ago")
    vi.setSystemTime(new Date("2026-10-29T12:01:30.000Z"))
    const errors: unknown[] = []
    await act(async () => { root = hydrateRoot(host, element, { onRecoverableError: (error) => errors.push(error) }) })
    expect(errors).toEqual([])
    expect(host.textContent).toContain("ago")
    expect(host.textContent).toContain("Last reply")
  })
})
