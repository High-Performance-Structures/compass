/** @vitest-environment jsdom */

import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"

import { MessageItem } from "../message-item"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/contexts/conversations-context", () => ({
  useConversations: () => ({ openThread: vi.fn() }),
}))
vi.mock("@/app/actions/chat-messages", () => ({
  addReaction: vi.fn(),
  deleteMessage: vi.fn(),
  removeReaction: vi.fn(),
}))

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
})

it("refreshes the memoized body and sender when only import metadata changes", async () => {
  const message = {
    id: "same-message-id",
    channelId: "sample-channel",
    threadId: null,
    content: "**literal** <person@example.test>\n---",
    contentHtml: null,
    editedAt: null,
    deletedAt: null,
    isPinned: false,
    replyCount: 0,
    lastReplyAt: null,
    createdAt: "2024-01-01T12:00:00Z",
    user: {
      id: "technical-actor",
      displayName: "Import user",
      email: "staff@example.test",
      avatarUrl: null,
    },
  }
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)

  try {
    await act(async () => root.render(React.createElement(MessageItem, { message })))
    expect(host.querySelector("strong")?.textContent).toBe("literal")

    const imported = { ...message, sourceSystem: "buildertrend", importedSenderName: "Original sender" }
    await act(async () => root.render(React.createElement(MessageItem, { message: imported })))
    expect(host.querySelector(".chat-markdown")?.textContent).toBe(message.content)
    expect(host.querySelector(".chat-markdown strong")).toBeNull()
    expect(host.textContent).toContain("Original sender")

    await act(async () => root.render(React.createElement(MessageItem, {
      message: { ...imported, importedSenderName: "Corrected sender" },
    })))
    expect(host.textContent).toContain("Corrected sender")
    expect(host.textContent).not.toContain("Original sender")
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
