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
})
