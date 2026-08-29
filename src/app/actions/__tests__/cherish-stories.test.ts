import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  requireAuth: vi.fn(),
  revalidatePath: vi.fn(),
  createNotificationEvent: vi.fn(),
}))

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/notifications/events", () => ({
  createNotificationEvent: mocks.createNotificationEvent,
}))
vi.mock("@/lib/user-roles", () => ({
  isInternalStaffRole: vi.fn(() => true),
}))

import {
  deleteCherishStoryReply,
  getActiveCherishStories,
  markCherishStoryViewed,
  sendCherishStoryReply,
} from "@/app/actions/cherish-stories"

describe("CHERISH stories", () => {
  beforeEach(() => {
    mocks.requireAuth.mockResolvedValue({
      id: "staff-1",
      organizationId: "org-1",
      organizationType: "internal",
      isActive: true,
      role: "office",
      email: "staff@example.com",
    })
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: {} } })
    mocks.getDb.mockReset()
    mocks.revalidatePath.mockReset()
    mocks.createNotificationEvent.mockReset()
  })

  it("returns active company stories with the current user's state", async () => {
    const storyRows = [
      {
        id: "story-1",
        cherishValue: "Honor",
        responseType: "shoutout",
        message: "A thoughtful handoff made the day better.",
        isAnonymous: false,
        submittedByName: "Nicholai",
        publishedAt: "2026-08-29T12:00:00.000Z",
      },
    ]
    const storyQuery = {
      from: vi.fn(),
      where: vi.fn(),
      orderBy: vi.fn(),
      limit: vi.fn(),
    }
    storyQuery.from.mockReturnValue(storyQuery)
    storyQuery.where.mockReturnValue(storyQuery)
    storyQuery.orderBy.mockReturnValue(storyQuery)
    storyQuery.limit.mockResolvedValue(storyRows)

    const stateQuery = { from: vi.fn(), where: vi.fn() }
    stateQuery.from.mockReturnValue(stateQuery)
    stateQuery.where.mockResolvedValue([
      {
        responseId: "story-1",
        viewedAt: "2026-08-29T12:05:00.000Z",
        reactedAt: "2026-08-29T12:06:00.000Z",
      },
    ])

    const reactionQuery = {
      from: vi.fn(),
      where: vi.fn(),
      groupBy: vi.fn(),
    }
    reactionQuery.from.mockReturnValue(reactionQuery)
    reactionQuery.where.mockReturnValue(reactionQuery)
    reactionQuery.groupBy.mockResolvedValue([
      { responseId: "story-1", reactionCount: 4 },
    ])

    mocks.getDb.mockReturnValue({
      select: vi
        .fn()
        .mockReturnValueOnce(storyQuery)
        .mockReturnValueOnce(stateQuery)
        .mockReturnValueOnce(reactionQuery),
    })

    const result = await getActiveCherishStories()

    expect(result).toEqual({
      success: true,
      data: [
        {
          ...storyRows[0],
          viewedAt: "2026-08-29T12:05:00.000Z",
          reactedAt: "2026-08-29T12:06:00.000Z",
          reactionCount: 4,
          audience: { scope: "company" },
        },
      ],
    })
    expect(storyQuery.limit).toHaveBeenCalledWith(20)
  })

  it("upserts viewed state only after confirming the story is active", async () => {
    const accessQuery = { from: vi.fn(), where: vi.fn(), get: vi.fn() }
    accessQuery.from.mockReturnValue(accessQuery)
    accessQuery.where.mockReturnValue(accessQuery)
    accessQuery.get.mockResolvedValue({ id: "story-1" })

    const insertQuery = {
      values: vi.fn(),
      onConflictDoUpdate: vi.fn(),
      run: vi.fn(),
    }
    insertQuery.values.mockReturnValue(insertQuery)
    insertQuery.onConflictDoUpdate.mockReturnValue(insertQuery)
    insertQuery.run.mockResolvedValue(undefined)
    mocks.getDb.mockReturnValue({
      select: vi.fn().mockReturnValue(accessQuery),
      insert: vi.fn().mockReturnValue(insertQuery),
    })

    const result = await markCherishStoryViewed({ id: "story-1" })

    expect(result.success).toBe(true)
    expect(insertQuery.values).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        responseId: "story-1",
        userId: "staff-1",
      }),
    )
    expect(insertQuery.onConflictDoUpdate).toHaveBeenCalledOnce()
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard")
  })

  it("sends a private reply to the original submitter", async () => {
    const accessQuery = { from: vi.fn(), where: vi.fn(), get: vi.fn() }
    accessQuery.from.mockReturnValue(accessQuery)
    accessQuery.where.mockReturnValue(accessQuery)
    accessQuery.get.mockResolvedValue({
      id: "story-1",
      recipientId: "author-1",
      recipientEmail: "author@example.com",
    })
    const deliveryQuery = {
      from: vi.fn(),
      innerJoin: vi.fn(),
      where: vi.fn(),
      get: vi.fn(),
    }
    deliveryQuery.from.mockReturnValue(deliveryQuery)
    deliveryQuery.innerJoin.mockReturnValue(deliveryQuery)
    deliveryQuery.where.mockReturnValue(deliveryQuery)
    deliveryQuery.get.mockResolvedValue({ id: "delivery-1" })

    const insertQuery = { values: vi.fn(), run: vi.fn() }
    insertQuery.values.mockReturnValue(insertQuery)
    insertQuery.run.mockResolvedValue(undefined)
    mocks.getDb.mockReturnValue({
      select: vi
        .fn()
        .mockReturnValueOnce(accessQuery)
        .mockReturnValueOnce(deliveryQuery),
      insert: vi.fn().mockReturnValue(insertQuery),
    })
    mocks.createNotificationEvent.mockResolvedValue(undefined)

    const result = await sendCherishStoryReply({
      id: "story-1",
      message: "This made my day too.",
    })

    expect(result.success).toBe(true)
    expect(insertQuery.values).toHaveBeenCalledWith(
      expect.objectContaining({
        responseId: "story-1",
        authorId: "staff-1",
        recipientId: "author-1",
        message: "This made my day too.",
      }),
    )
    expect(mocks.createNotificationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "cherish.story_reply",
        recipients: [
          { userId: "author-1", email: "author@example.com" },
        ],
      }),
    )
  })

  it("rolls back a private reply when delivery fails", async () => {
    const accessQuery = { from: vi.fn(), where: vi.fn(), get: vi.fn() }
    accessQuery.from.mockReturnValue(accessQuery)
    accessQuery.where.mockReturnValue(accessQuery)
    accessQuery.get.mockResolvedValue({
      id: "story-1",
      recipientId: "author-1",
      recipientEmail: "author@example.com",
    })

    const insertQuery = { values: vi.fn(), run: vi.fn() }
    insertQuery.values.mockReturnValue(insertQuery)
    insertQuery.run.mockResolvedValue(undefined)
    const notificationUpdate = { set: vi.fn(), where: vi.fn() }
    notificationUpdate.set.mockReturnValue(notificationUpdate)
    notificationUpdate.where.mockReturnValue(notificationUpdate)
    const replyUpdate = { set: vi.fn(), where: vi.fn() }
    replyUpdate.set.mockReturnValue(replyUpdate)
    replyUpdate.where.mockReturnValue(replyUpdate)
    const batch = vi.fn().mockResolvedValue(undefined)
    mocks.getDb.mockReturnValue({
      select: vi.fn().mockReturnValue(accessQuery),
      insert: vi.fn().mockReturnValue(insertQuery),
      update: vi
        .fn()
        .mockReturnValueOnce(notificationUpdate)
        .mockReturnValueOnce(replyUpdate),
      batch,
    })
    mocks.createNotificationEvent.mockRejectedValue(
      new Error("notification storage unavailable"),
    )

    const result = await sendCherishStoryReply({
      id: "story-1",
      message: "This made my day too.",
    })

    expect(result).toEqual({
      success: false,
      error: "Unable to deliver this CHERISH reply. Please try again.",
    })
    expect(notificationUpdate.set).toHaveBeenCalledWith({
      title: "CHERISH reply not delivered",
      body: "This reply could not be delivered.",
    })
    expect(replyUpdate.set).toHaveBeenCalledWith({
      deletedAt: expect.any(String),
    })
    expect(batch).toHaveBeenCalledOnce()
  })

  it("does not save a reply when the story has no reachable author", async () => {
    const accessQuery = { from: vi.fn(), where: vi.fn(), get: vi.fn() }
    accessQuery.from.mockReturnValue(accessQuery)
    accessQuery.where.mockReturnValue(accessQuery)
    accessQuery.get.mockResolvedValue({
      id: "story-1",
      recipientId: null,
      recipientEmail: null,
    })
    const insert = vi.fn()
    mocks.getDb.mockReturnValue({
      select: vi.fn().mockReturnValue(accessQuery),
      insert,
    })

    const result = await sendCherishStoryReply({
      id: "story-1",
      message: "Thank you!",
    })

    expect(result).toEqual({
      success: false,
      error: "Private replies are not available for this CHERISH.",
    })
    expect(insert).not.toHaveBeenCalled()
    expect(mocks.createNotificationEvent).not.toHaveBeenCalled()
  })

  it("redacts the delivered notification before removing a reply", async () => {
    const replyQuery = { from: vi.fn(), where: vi.fn(), get: vi.fn() }
    replyQuery.from.mockReturnValue(replyQuery)
    replyQuery.where.mockReturnValue(replyQuery)
    replyQuery.get.mockResolvedValue({ id: "reply-1" })

    const notificationUpdate = {
      set: vi.fn(),
      where: vi.fn(),
      run: vi.fn(),
    }
    notificationUpdate.set.mockReturnValue(notificationUpdate)
    notificationUpdate.where.mockReturnValue(notificationUpdate)
    notificationUpdate.run.mockResolvedValue(undefined)
    const replyUpdate = {
      set: vi.fn(),
      where: vi.fn(),
      run: vi.fn(),
    }
    replyUpdate.set.mockReturnValue(replyUpdate)
    replyUpdate.where.mockReturnValue(replyUpdate)
    replyUpdate.run.mockResolvedValue(undefined)
    mocks.getDb.mockReturnValue({
      select: vi.fn().mockReturnValue(replyQuery),
      update: vi
        .fn()
        .mockReturnValueOnce(notificationUpdate)
        .mockReturnValueOnce(replyUpdate),
    })

    const result = await deleteCherishStoryReply({ id: "reply-1" })

    expect(result).toEqual({ success: true, data: { id: "reply-1" } })
    expect(notificationUpdate.set).toHaveBeenCalledWith({
      title: "CHERISH reply removed",
      body: "This reply was removed by its sender.",
    })
    expect(replyUpdate.set).toHaveBeenCalledWith({
      deletedAt: expect.any(String),
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout")
  })
})
