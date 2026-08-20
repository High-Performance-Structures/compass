import { describe, expect, it } from "vitest"

import type { FieldProjectPacket } from "../src/lib/field/types"
import {
  appendOptimisticDirectMessage,
  pushNotificationHref,
} from "./conversation-state"

function packet(): FieldProjectPacket {
  return {
    project: { id: "project-1", name: "Project", projectNumber: null, address: null },
    tasks: [], logs: [], documents: [], channel: null, messages: [],
    directConversations: [
      {
        id: "channel-1", name: "Wes", unreadCount: 0,
        messages: [{ id: "message-1", content: "Hello", createdAt: "2026-08-20T12:00:00.000Z", userName: "Wes" }],
      },
      { id: "channel-2", name: "Office", unreadCount: 0, messages: [] },
    ],
    contacts: [], notifications: [], syncedAt: "2026-08-20T12:00:00.000Z",
  }
}

describe("appendOptimisticDirectMessage", () => {
  it("keeps a sent reply visible in its direct conversation", () => {
    const original = packet()
    const updated = appendOptimisticDirectMessage(original, {
      channelId: "channel-1", id: "queued-1", content: "On my way",
      createdAt: "2026-08-20T12:01:00.000Z", userName: "Martine",
    })

    expect(updated.directConversations[0]?.messages.at(-1)).toEqual({
      id: "queued-1", content: "On my way",
      createdAt: "2026-08-20T12:01:00.000Z", userName: "Martine",
    })
    expect(updated.directConversations[1]).toBe(original.directConversations[1])
  })

  it("does not duplicate the same queued reply", () => {
    const message = {
      channelId: "channel-1", id: "queued-1", content: "On my way",
      createdAt: "2026-08-20T12:01:00.000Z", userName: "Martine",
    }
    const twice = appendOptimisticDirectMessage(
      appendOptimisticDirectMessage(packet(), message),
      message
    )

    expect(twice.directConversations[0]?.messages.filter((item) => item.id === "queued-1")).toHaveLength(1)
  })
})

describe("pushNotificationHref", () => {
  it("accepts either notification URL field", () => {
    expect(pushNotificationHref({ url: "/dashboard/conversations/channel-1" })).toBe("/dashboard/conversations/channel-1")
    expect(pushNotificationHref({ href: "/dashboard/conversations/channel-2" })).toBe("/dashboard/conversations/channel-2")
  })

  it("rejects invalid push data", () => {
    expect(pushNotificationHref(null)).toBeNull()
    expect(pushNotificationHref({ url: 42 })).toBeNull()
  })
})
