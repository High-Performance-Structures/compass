import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/notifications/events", () => ({
  createSystemNotificationEvent: vi.fn(),
}))

import { runFeedbackRequesterNotification } from "@/lib/jarvis/feedback-status-update"

describe("feedback requester notification idempotency", () => {
  it("atomically claims one requester event across concurrent lifecycle retries", async () => {
    const eventKeys = new Set<string>()
    const claimedEvents: string[] = []
    const notifications: string[] = []
    const insertEvent = async (idempotencyKey: string): Promise<Readonly<{ changes: number }>> => {
      await Promise.resolve()
      if (eventKeys.has(idempotencyKey)) return { changes: 0 }
      eventKeys.add(idempotencyKey)
      claimedEvents.push(idempotencyKey)
      return { changes: 1 }
    }
    const claim = (): Promise<boolean> => runFeedbackRequesterNotification(
      () => insertEvent("notify:feedback-1:status-v1"),
      async () => {
        notifications.push("notify:feedback-1:status-v1")
      },
    )

    const results = await Promise.all([claim(), claim()])

    expect(results.sort()).toEqual([false, true])
    expect(claimedEvents).toEqual(["notify:feedback-1:status-v1"])
    expect(notifications).toEqual(["notify:feedback-1:status-v1"])
  })

  it("rejects a reclaimed replay after the original event was claimed", async () => {
    let eventCount = 0
    let notificationCount = 0
    const insertEvent = async (): Promise<Readonly<{ changes: number }>> => {
      if (eventCount > 0) return { changes: 0 }
      eventCount += 1
      return { changes: 1 }
    }
    const notify = async (): Promise<void> => {
      notificationCount += 1
    }

    await expect(runFeedbackRequesterNotification(insertEvent, notify)).resolves.toBe(true)
    await expect(runFeedbackRequesterNotification(insertEvent, notify)).resolves.toBe(false)
    expect(eventCount).toBe(1)
    expect(notificationCount).toBe(1)
  })
})
