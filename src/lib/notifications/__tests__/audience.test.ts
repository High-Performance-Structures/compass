import { describe, expect, it } from "vitest"

import { channelNotificationRecipients } from "@/lib/notifications/audience"

const MEMBERS = [
  {
    userId: "sender",
    email: "sender@example.com",
    notifyLevel: "all",
  },
  {
    userId: "channel-member",
    email: "member@example.com",
    notifyLevel: "all",
  },
  {
    userId: "mentions-only",
    email: "mentions@example.com",
    notifyLevel: "mentions",
  },
  {
    userId: "muted",
    email: "muted@example.com",
    notifyLevel: "none",
  },
] as const

describe("channel notification audience", () => {
  it("notifies ordinary channel members without requiring a mention", () => {
    expect(
      channelNotificationRecipients(MEMBERS, "sender", [])
    ).toEqual([
      {
        userId: "channel-member",
        email: "member@example.com",
      },
    ])
  })

  it("respects mentions-only and muted channel preferences", () => {
    expect(
      channelNotificationRecipients(MEMBERS, "sender", [
        {
          mentionType: "user",
          targetId: "mentions-only",
        },
      ])
    ).toEqual([
      {
        userId: "channel-member",
        email: "member@example.com",
      },
      {
        userId: "mentions-only",
        email: "mentions@example.com",
      },
    ])
  })
})
