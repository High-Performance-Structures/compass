import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("@/lib/db", () => ({
  getCloudflareContext: mocks.getCloudflareContext,
}))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))

import { createStrictSystemNotificationEvent } from "../create-event"

function queryResult(rows: readonly unknown[]) {
  const chain = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    then: (
      resolve: (value: readonly unknown[]) => unknown,
      reject?: (error: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject),
  }
  chain.from.mockReturnValue(chain)
  chain.innerJoin.mockReturnValue(chain)
  chain.where.mockReturnValue(chain)
  chain.limit.mockReturnValue(chain)
  return chain
}

function databaseWithClaimedRecipient() {
  const select = vi.fn()
    .mockReturnValueOnce(queryResult([{
      userId: "requester-1",
      email: "requester@example.com",
      googleEmail: null,
    }]))
    .mockReturnValueOnce(queryResult([]))
    .mockReturnValueOnce(queryResult([]))

  let insertNumber = 0
  const insert = vi.fn(() => {
    insertNumber += 1
    const changes = insertNumber === 2 ? 0 : 1
    const run = vi.fn().mockResolvedValue({ meta: { changes } })
    const onConflictDoNothing = vi.fn(() => ({ run }))
    const values = vi.fn(() => ({ onConflictDoNothing }))
    return { values }
  })

  return { select, insert }
}

function databaseWithGuardedDeliveryReservation() {
  const select = vi.fn()
    .mockReturnValueOnce(queryResult([{
      userId: "requester-1",
      email: "requester@example.com",
      googleEmail: null,
    }]))
    .mockReturnValueOnce(queryResult([]))
    .mockReturnValueOnce(queryResult([
      { id: "delivery-email", channel: "email", status: "attempting" },
      { id: "delivery-push", channel: "push", status: "attempting" },
    ]))
  const statement = { run: vi.fn() }
  const insert = vi.fn(() => ({
    select: vi.fn(() => statement),
    values: vi.fn(() => ({
      onConflictDoNothing: vi.fn(() => statement),
    })),
  }))
  const batch = vi.fn()
    .mockResolvedValueOnce([
      { meta: { changes: 0 } },
      { meta: { changes: 1 } },
    ])
    .mockResolvedValueOnce([
      { meta: { changes: 0 } },
      { meta: { changes: 0 } },
      { meta: { changes: 0 } },
      { meta: { changes: 0 } },
    ])
  const updateWhere = vi.fn().mockResolvedValue(undefined)
  const updateSet = vi.fn(() => ({ where: updateWhere }))
  const update = vi.fn(() => ({ set: updateSet }))
  return { select, insert, update, batch }
}

function databaseWithPendingProviderDelivery() {
  const select = vi.fn()
    .mockReturnValueOnce(queryResult([{
      userId: "requester-1",
      email: "requester@example.com",
      googleEmail: null,
    }]))
    .mockReturnValueOnce(queryResult([]))
    .mockReturnValueOnce(queryResult([
      { id: "delivery-email", channel: "email", status: "pending_provider" },
    ]))
  let insertNumber = 0
  const insert = vi.fn(() => {
    insertNumber += 1
    const changes = insertNumber === 1 ? 1 : 0
    const run = vi.fn().mockResolvedValue({ meta: { changes } })
    const onConflictDoNothing = vi.fn(() => ({ run }))
    const values = vi.fn(() => ({ onConflictDoNothing }))
    return { values }
  })
  const updateSet = vi.fn(() => ({
    where: vi.fn(() => ({
      run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
    })),
  }))
  return {
    select,
    insert,
    update: vi.fn(() => ({ set: updateSet })),
    updateSet,
  }
}

describe("strict notification idempotency", () => {
  beforeEach(() => {
    mocks.getCloudflareContext.mockReset()
    mocks.getDb.mockReset()
    mocks.revalidatePath.mockReset()
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: {} } })
  })

  it("does not treat a claimed recipient with missing delivery rows as complete", async () => {
    mocks.getDb.mockReturnValue(databaseWithClaimedRecipient())

    await expect(createStrictSystemNotificationEvent({
      organizationId: "organization-1",
      projectId: null,
      eventType: "feedback.status_changed",
      sourceType: "feedback_desk",
      sourceId: "feedback-1",
      title: "Feedback request updated",
      body: "Your request moved to testing.",
      href: "/dashboard/feedback",
      priority: "normal",
      audience: "individual",
      recipients: [{
        userId: "requester-1",
        email: "requester@example.com",
      }],
      delivery: { inApp: true, email: true, push: false },
      idempotencyKey: "feedback-requester:event-1",
    })).rejects.toThrow("delivery is still in progress")

    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("recovers guarded multi-channel delivery reservations", async () => {
    const db = databaseWithGuardedDeliveryReservation()
    mocks.getDb.mockReturnValue(db)

    await expect(createStrictSystemNotificationEvent({
      organizationId: "organization-1",
      projectId: null,
      eventType: "feedback.status_changed",
      sourceType: "feedback_desk",
      sourceId: "feedback-1",
      title: "Feedback request updated",
      body: "Your request moved to testing.",
      href: "/dashboard/feedback",
      priority: "normal",
      audience: "individual",
      recipients: [{
        userId: "requester-1",
        email: "requester@example.com",
      }],
      delivery: { inApp: true, email: true, push: true },
      idempotencyKey: "feedback-requester:event-1",
    }, {
      eventId: "notification-event-1",
      claimToken: "notification-claim-1",
      reservationResult: null,
    })).resolves.toBeUndefined()

    expect(db.batch).toHaveBeenCalledTimes(4)
    expect(db.batch.mock.calls[1]?.[0]).toHaveLength(4)
    expect(db.update).toHaveBeenCalledTimes(2)
  })

  it("reopens pending-provider deliveries on a later idempotent replay", async () => {
    const db = databaseWithPendingProviderDelivery()
    mocks.getDb.mockReturnValue(db)

    await expect(createStrictSystemNotificationEvent({
      organizationId: "organization-1",
      projectId: null,
      eventType: "feedback.status_changed",
      sourceType: "feedback_desk",
      sourceId: "feedback-1",
      title: "Feedback request updated",
      body: "Your request moved to testing.",
      href: "/dashboard/feedback",
      priority: "normal",
      audience: "individual",
      recipients: [{
        userId: "requester-1",
        email: "requester@example.com",
      }],
      delivery: { inApp: true, email: true, push: false },
    })).rejects.toThrow("Notification provider delivery pending")

    expect(db.updateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: "attempting",
    }))
    expect(db.updateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: "pending_provider",
    }))
  })
})
