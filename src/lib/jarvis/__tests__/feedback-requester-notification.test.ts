import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/notifications/events", () => ({
  createStrictSystemNotificationEvent: async () => {},
}))

function database(
  shared: { claimCount: number },
  options: Readonly<{ lostClaimOn: "finalize" | "retry" | null }> = {
    lostClaimOn: null,
  },
) {
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
  let updateCallCount = 0
  const updateWhere = vi.fn().mockImplementation(() => {
    updateCallCount += 1
    if (updateCallCount === 1) {
      return {
        returning: vi.fn().mockReturnValue({ get: claimResult }),
      }
    }
    const lostClaim = updateCallCount === 2 && options.lostClaimOn !== null
    return {
      returning: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue(
          lostClaim ? undefined : { id: "notification-event-1" },
        ),
      }),
    }
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
    const persistNotification = async (
      input: Readonly<Record<string, unknown>>,
      ownership?: Readonly<Record<string, unknown>>,
    ) => {
      notificationCallCount += 1
      expect(input.idempotencyKey).toBe("notification-event-1")
      expect(ownership).toEqual(expect.objectContaining({
        eventId: "notification-event-1",
        claimToken: expect.any(String),
        reservationResult: null,
      }))
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

  it("does not finalize after a stale worker loses its claim", async () => {
    const fixture = database(
      { claimCount: 0 },
      { lostClaimOn: "finalize" },
    )

    const { processFeedbackRequesterNotification } = await import(
      "@/lib/jarvis/feedback-status-update"
    )
    await expect(processFeedbackRequesterNotification(fixture.db as never, {
      id: "status-event-1",
      idempotencyKey: "bridge-retry-1",
      feedbackDeskItemId: "feedback-1",
    })).resolves.toEqual({
      queued: true,
      claimed: false,
      notifiedUserCount: 0,
    })
  })

  it("does not reset a replacement claim when persistence fails", async () => {
    const fixture = database(
      { claimCount: 0 },
      { lostClaimOn: "retry" },
    )
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
    }, persistNotification)).resolves.toEqual({
      queued: true,
      claimed: false,
      notifiedUserCount: 0,
    })
  })
})
