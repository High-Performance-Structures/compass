import { describe, expect, it } from "vitest"
import { messageKind, messageStacksFrom, portfolioMessagesHref } from "@/lib/notifications/message-stacks"

describe("messageKind", () => {
  it("sorts bell items into tile kinds", () => {
    expect(messageKind({ sourceType: "message", eventType: "message.channel" })).toBe("message")
    expect(messageKind({ sourceType: "project_correspondence", eventType: "project_message" })).toBe("mail")
    expect(messageKind({ sourceType: "rfi", eventType: "rfi.created" })).toBe("rfi")
    expect(messageKind({ sourceType: "schedule", eventType: "schedule.end_date_extended" })).toBe("schedule")
    expect(messageKind({ sourceType: "warranty_claim", eventType: "warranty.created" })).toBe("other")
  })
})

describe("messageStacksFrom", () => {
  it("counts only unread items that belong to a project", () => {
    const stacks = messageStacksFrom([
      { sourceType: "message", eventType: "message.channel", projectId: "p1", readAt: null },
      { sourceType: "rfi", eventType: "rfi.created", projectId: "p1", readAt: null },
      { sourceType: "message", eventType: "message.channel", projectId: "p1", readAt: "2026-10-08T10:00:00Z" },
      { sourceType: "message", eventType: "message.channel", projectId: null, readAt: null },
      { sourceType: "project_correspondence", eventType: "project_message", projectId: "p2", readAt: null },
    ])
    expect(stacks.get("p1")).toEqual(["message", "rfi"])
    expect(stacks.get("p2")).toEqual(["mail"])
    expect(stacks.size).toBe(2)
  })

  it("links to the dashboard map with the layer on and the job selected", () => {
    expect(portfolioMessagesHref("job 1")).toBe("/dashboard?layer=messages&job=job%201#portfolio-title")
  })
})
