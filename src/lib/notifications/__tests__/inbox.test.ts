import { describe, expect, it } from "vitest"
import { conversationKey, groupInbox, type InboxItem } from "@/lib/notifications/inbox"

function item(overrides: Partial<InboxItem> & { readonly id: string }): InboxItem {
  return {
    title: "Title",
    body: "Body",
    href: "/dashboard/rfis/1",
    eventType: "rfi.created",
    sourceType: "rfi",
    projectId: "p1",
    projectLabel: "O-170-2684 - County Ln 7 - Loomis",
    readAt: null,
    createdAt: "2026-10-08T10:00:00.000Z",
    ...overrides,
  }
}

describe("conversationKey", () => {
  it("ignores the message scroll target for project messages", () => {
    const a = item({ id: "a", sourceType: "project_correspondence", href: "/dashboard/projects/p1/messages?conversationId=c1&messageId=m1" })
    const b = item({ id: "b", sourceType: "project_correspondence", href: "/dashboard/projects/p1/messages?conversationId=c1&messageId=m2" })
    expect(conversationKey(a)).toBe(conversationKey(b))
  })

  it("does not group non-message items", () => {
    expect(conversationKey(item({ id: "a" }))).toBeNull()
  })
})

describe("groupInbox", () => {
  it("stacks a conversation's messages and keeps other items separate", () => {
    const sections = groupInbox([
      item({ id: "m3", sourceType: "message", href: "/dashboard/conversations/c1", createdAt: "2026-10-08T12:00:00.000Z" }),
      item({ id: "r1", createdAt: "2026-10-08T11:00:00.000Z" }),
      item({ id: "m2", sourceType: "message", href: "/dashboard/conversations/c1", createdAt: "2026-10-08T10:00:00.000Z", readAt: "2026-10-08T10:05:00.000Z" }),
      item({ id: "m1", sourceType: "message", href: "/dashboard/conversations/c1", createdAt: "2026-10-08T09:00:00.000Z" }),
    ])
    expect(sections).toHaveLength(1)
    const rows = sections[0]?.rows ?? []
    expect(rows.map((row) => row.latest.id)).toEqual(["m3", "r1"])
    expect(rows[0]?.items.map((entry) => entry.id)).toEqual(["m3", "m2", "m1"])
    expect(rows[0]?.unreadCount).toBe(2)
    expect(sections[0]?.unreadCount).toBe(3)
  })

  it("puts sections with unread items first and labels items without a project", () => {
    const sections = groupInbox([
      item({ id: "read", projectId: "p2", projectLabel: "H-1 Newer", readAt: "2026-10-08T12:00:00.000Z", createdAt: "2026-10-08T12:00:00.000Z" }),
      item({ id: "general", projectId: null, projectLabel: null, createdAt: "2026-10-08T08:00:00.000Z" }),
    ])
    expect(sections.map((section) => section.label)).toEqual(["General", "H-1 Newer"])
  })
})
