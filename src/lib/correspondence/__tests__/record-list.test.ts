import { describe, expect, it } from "vitest"

import {
  conversationActivityAt,
  conversationStatusChips,
  conversationStatusSortValue,
  conversationTypeLabel,
  conversationWith,
} from "@/lib/correspondence/record-list"
import type { CorrespondenceSummary } from "@/lib/correspondence/types"

function summary(patch: Partial<CorrespondenceSummary>): CorrespondenceSummary {
  return {
    id: "c1",
    projectId: "p1",
    subject: "Concrete pour",
    excerpt: "Pump confirmed",
    lastActivityAt: "2026-11-06T16:00:00.000Z",
    lastActivityDisplay: null,
    lastActivitySourceLocal: false,
    people: [
      { userId: "u1", name: "Dana Ruiz", email: "dana@example.com", role: "sub_vendor", delivery: "compass" },
      { userId: "u2", name: "Site super", email: "super@example.com", role: "staff", delivery: "compass" },
    ],
    unread: false,
    saved: false,
    followUp: false,
    archived: false,
    closed: false,
    shareReadReceipts: true,
    ...patch,
  }
}

describe("messages sheet rows", () => {
  it("labels email threads and portal messages", () => {
    expect(conversationTypeLabel(summary({ kind: "email" }))).toBe("Email")
    expect(conversationTypeLabel(summary({ kind: "message" }))).toBe("Message")
    expect(conversationTypeLabel(summary({}))).toBe("Message")
  })

  it("lists the people and uses the sent time on Sent", () => {
    expect(conversationWith(summary({}))).toBe("Dana Ruiz, Site super")
    const row = summary({ lastSentAt: "2026-11-05T10:00:00.000Z" })
    expect(conversationActivityAt(row, "sent")).toBe("2026-11-05T10:00:00.000Z")
    expect(conversationActivityAt(row, "inbox")).toBe("2026-11-06T16:00:00.000Z")
  })

  it("orders status chips and sorts flagged conversations first", () => {
    const row = summary({ unread: true, followUp: true, saved: true })
    expect(conversationStatusChips(row)).toEqual(["Unread", "Needs reply", "Saved"])
    expect(conversationStatusSortValue(row)).toBe(7)
    expect(conversationStatusSortValue(summary({}))).toBeUndefined()
  })
})
