import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  recordActivityEvent: vi.fn(),
  notifyScheduleEndDateExtended: vi.fn(),
}))
vi.mock("@/lib/activity-log", () => ({ recordActivityEvent: mocks.recordActivityEvent }))
vi.mock("@/lib/notifications/events", () => ({
  notifyScheduleEndDateExtended: mocks.notifyScheduleEndDateExtended,
}))

import { recordScheduleShift } from "../record-shift"

type ShiftInput = Parameters<typeof recordScheduleShift>[0]

function dbWithSchedulePublished(schedulePublished: boolean): ShiftInput["db"] {
  const query = {
    from: () => query,
    where: () => query,
    get: async () => ({ schedulePublished }),
  }
  const db: unknown = { select: () => query }
  // The shift recorder only reads the project's published flag.
  return db as ShiftInput["db"]
}

function shift(schedulePublished: boolean): ShiftInput {
  return {
    db: dbWithSchedulePublished(schedulePublished),
    organizationId: "org-a",
    projectId: "project-a",
    actor: { id: "staff-a", email: "staff@example.test", role: "admin" } as ShiftInput["actor"],
    sourceType: "schedule_task",
    sourceId: "task-a",
    sourceLabel: "Framing",
    reason: "Lumber delivery moved",
    summary: {
      affectedItemCount: 3,
      previousProjectEnd: "2026-12-01",
      nextProjectEnd: "2026-12-10",
      extendsProjectEnd: true,
    },
  }
}

afterEach(() => vi.clearAllMocks())

describe("recordScheduleShift", () => {
  it("tells project administrators when a published schedule's finish moves later", async () => {
    await recordScheduleShift(shift(true))
    expect(mocks.recordActivityEvent).toHaveBeenCalledOnce()
    expect(mocks.notifyScheduleEndDateExtended).toHaveBeenCalledOnce()
  })

  it("keeps a draft schedule quiet: activity is recorded, nobody is notified", async () => {
    await recordScheduleShift(shift(false))
    expect(mocks.recordActivityEvent).toHaveBeenCalledOnce()
    expect(mocks.notifyScheduleEndDateExtended).not.toHaveBeenCalled()
  })
})
