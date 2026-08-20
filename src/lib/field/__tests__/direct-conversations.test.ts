import { describe, expect, it } from "vitest"

import { orderDirectConversationsByActivity } from "@/lib/field/direct-conversations"

describe("field direct conversation activity", () => {
  it("puts an older conversation with a new message first", () => {
    const conversations = [
      {
        id: "new-channel",
        createdAt: "2026-08-20T10:00:00.000Z",
        updatedAt: "2026-08-20T10:00:00.000Z",
      },
      {
        id: "sylvi-channel",
        createdAt: "2026-01-10T10:00:00.000Z",
        updatedAt: "2026-08-20T11:00:00.000Z",
      },
    ]

    expect(orderDirectConversationsByActivity(conversations).map(({ id }) => id)).toEqual([
      "sylvi-channel",
      "new-channel",
    ])
  })

  it("keeps every conversation available to the mobile selector", () => {
    const conversations = Array.from({ length: 12 }, (_, index) => ({
      id: `channel-${index}`,
      createdAt: `2026-08-20T10:${String(index).padStart(2, "0")}:00.000Z`,
      updatedAt: `2026-08-20T10:${String(index).padStart(2, "0")}:00.000Z`,
    }))

    expect(orderDirectConversationsByActivity(conversations)).toHaveLength(12)
  })
})
