import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/notifications/create-event", () => ({ createSystemNotificationEvent: vi.fn() }))

import { staleReminderDue } from "@/lib/staff-message-desk/stale-reminders"
import { STAFF_MESSAGE_AGING } from "@/lib/staff-message-desk/triage"

// Activity on Monday 2026-10-05; stale (5 business days) from Monday 2026-10-12.
const base = {
  status: "in_progress",
  createdAt: "2026-10-05T15:00:00.000Z",
  updatedAt: "2026-10-05T15:00:00.000Z",
  lastActivityAt: "2026-10-05T15:00:00.000Z",
  staleRemindedAt: null,
}
const monday = new Date("2026-10-12T16:00:00.000Z")

describe("staleReminderDue", () => {
  it("is due once a message goes stale", () => {
    expect(staleReminderDue(base, new Date("2026-10-09T16:00:00.000Z"), STAFF_MESSAGE_AGING)).toBe(false)
    expect(staleReminderDue(base, monday, STAFF_MESSAGE_AGING)).toBe(true)
  })

  it("is not repeated for the same stale stretch", () => {
    expect(staleReminderDue({ ...base, staleRemindedAt: "2026-10-12T15:30:00.000Z" }, monday, STAFF_MESSAGE_AGING)).toBe(false)
  })

  it("is due again if the message goes stale after new follow-up", () => {
    const followedUp = { ...base, staleRemindedAt: "2026-10-12T15:30:00.000Z", lastActivityAt: "2026-10-13T15:00:00.000Z" }
    expect(staleReminderDue(followedUp, new Date("2026-10-20T16:00:00.000Z"), STAFF_MESSAGE_AGING)).toBe(true)
  })

  it("follows the company's thresholds and skips closed messages", () => {
    expect(staleReminderDue(base, monday, { ...STAFF_MESSAGE_AGING, staleDays: 10, agingDays: 3 })).toBe(false)
    expect(staleReminderDue({ ...base, status: "closed" }, monday, STAFF_MESSAGE_AGING)).toBe(false)
  })
})
