import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/notifications/events", () => ({
  createStrictSystemNotificationEvent: async () => {},
}))

function database(shared: { claimCount: number }) {
  const selectGet = vi.fn()
    .mockResolvedValueOnce({
      id: "notification-event-1",
      status: "pending",
      feedbackDeskItemId: "feedback-1",
      payload: JSON.stringify({
        schemaVersion: 1,
        feedbackDeskItemId: "feedback-1",
        reference: "CFD-feedback-1",
        kind: "bug",
        status: "triaged",
        notificationKind: "status_changed",
      }),
    })
    .mockResolvedValueOnce({
      id: "feedback-1",
      organizationId: "org-1",
      kind: "bug",
      title: "Private title",
      status: "triaged",
      reporterEmail: "person@example.com",
      metadata: null,
    })
    .mockResolvedValueOnce([{ userId: "user-1", email: "person@example.com" }])
  const selectChain = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    get: selectGet,
    all: vi.fn().mockImplementation(() => selectGet()),
  }
  selectChain.from.mockReturnValue(selectChain)
  selectChain.innerJoin.mockReturnValue(selectChain)
  selectChain.where.mockReturnValue(selectChain)
  const claimResult = vi.fn().mockImplementation(() => {
    shared.claimCount += 1
    return shared.claimCount === 1
      ? { id: "notification-event-1" }
      : undefined
  })
  const updateWhere = vi.fn().mockReturnValue({
    returning: vi.fn().mockReturnValue({ get: claimResult }),
  })
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere })
  const update = vi.fn().mockReturnValue({ set: updateSet })
  return {
    db: {
      select: vi.fn().mockReturnValue(selectChain),
      update,
    },
    updateSet,
  }
}

describe("Feedback Desk requester notification outbox", () => {
  it("lets only one concurrent retry claim the notification event", async () => {
    const shared = { claimCount: 0 }
    const first = database(shared)
    const second = database(shared)
    let notificationCallCount = 0
    const persistNotification = async () => {
      notificationCallCount += 1
    }

    const { processFeedbackRequesterNotification } = await import(
      "@/lib/jarvis/feedback-status-update"
    )
    const results = await Promise.allSettled([
      processFeedbackRequesterNotification(first.db as never, {
        id: "status-event-1",
        idempotencyKey: "bridge-retry-1",
        feedbackDeskItemId: "feedback-1",
      }, persistNotification),
      processFeedbackRequesterNotification(second.db as never, {
        id: "status-event-1",
        idempotencyKey: "bridge-retry-1",
        feedbackDeskItemId: "feedback-1",
      }, persistNotification),
    ])

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1)
    expect(notificationCallCount).toBe(1)
    expect(first.updateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: "completed",
    }))
  })

  it("leaves notification work pending when persistence fails", async () => {
    const fixture = database({ claimCount: 0 })
    const persistNotification = async () => {
      throw new Error("D1 unavailable")
    }

    const { processFeedbackRequesterNotification } = await import(
      "@/lib/jarvis/feedback-status-update"
    )
    await expect(processFeedbackRequesterNotification(fixture.db as never, {
      id: "status-event-1",
      idempotencyKey: "bridge-retry-1",
      feedbackDeskItemId: "feedback-1",
    }, persistNotification)).rejects.toThrow("D1 unavailable")

    expect(fixture.updateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: "pending",
      lastError: "D1 unavailable",
      completedAt: null,
    }))
  })
})
