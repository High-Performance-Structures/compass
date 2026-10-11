import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/notifications/create-event", () => ({ createSystemNotificationEvent: vi.fn() }))

import { overdueReminderDue } from "@/lib/project-follow-up-reminders"

describe("overdueReminderDue", () => {
  it("is due for an overdue job nobody was reminded about", () => {
    expect(overdueReminderDue({ level: "overdue", lastContactAt: "2026-09-01T15:00:00.000Z" }, null)).toBe(true)
    expect(overdueReminderDue({ level: "overdue", lastContactAt: null }, null)).toBe(true)
  })

  it("only fires for overdue, matching the map's level", () => {
    expect(overdueReminderDue({ level: "due", lastContactAt: null }, null)).toBe(false)
    expect(overdueReminderDue({ level: "on_track", lastContactAt: null }, null)).toBe(false)
  })

  it("doesn't repeat within one overdue stretch", () => {
    expect(overdueReminderDue({ level: "overdue", lastContactAt: "2026-09-01T15:00:00.000Z" }, "2026-09-10T15:00:00.000Z")).toBe(false)
    expect(overdueReminderDue({ level: "overdue", lastContactAt: null }, "2026-09-10T15:00:00.000Z")).toBe(false)
  })

  it("re-arms when the job goes overdue again after new contact", () => {
    expect(overdueReminderDue({ level: "overdue", lastContactAt: "2026-09-20T15:00:00.000Z" }, "2026-09-10T15:00:00.000Z")).toBe(true)
  })
})

import { responsibleFor } from "@/lib/project-follow-up-reminders"

describe("responsibleFor", () => {
  it("prefers the job's owner, then the last contact, then the department default", () => {
    expect(responsibleFor({ ownerUserId: "owner", lastContactBy: "caller", departmentDefault: "default" })).toBe("owner")
    expect(responsibleFor({ ownerUserId: null, lastContactBy: "caller", departmentDefault: "default" })).toBe("caller")
    expect(responsibleFor({ ownerUserId: null, lastContactBy: null, departmentDefault: "default" })).toBe("default")
    expect(responsibleFor({ ownerUserId: null, lastContactBy: null, departmentDefault: null })).toBeNull()
  })
})
