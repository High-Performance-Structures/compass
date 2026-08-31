import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  requireAuth: vi.fn(),
  revalidatePath: vi.fn(),
  createDirectMessage: vi.fn(),
  sendMessage: vi.fn(),
  deleteMessage: vi.fn(),
}))

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/app/actions/conversations", () => ({
  createDirectMessage: mocks.createDirectMessage,
}))
vi.mock("@/app/actions/chat-messages", () => ({
  sendMessage: mocks.sendMessage,
  deleteMessage: mocks.deleteMessage,
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
    mocks.createDirectMessage.mockReset()
    mocks.createDirectMessage.mockResolvedValue({
      success: true,
      data: { channelId: "direct:author-1:staff-1" },
    })
    mocks.sendMessage.mockReset()
    mocks.sendMessage.mockResolvedValue({
      success: true,
      data: { id: "message-1" },
    })
    mocks.deleteMessage.mockReset()
    mocks.deleteMessage.mockResolvedValue({ success: true })
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
        audienceScope: "company",
        audienceReferenceId: null,
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
          id: "story-1",
          cherishValue: "Honor",
          responseType: "shoutout",
          message: "A thoughtful handoff made the day better.",
          isAnonymous: false,
          submittedByName: "Nicholai",
          publishedAt: "2026-08-29T12:00:00.000Z",
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

  it("does not mutate a story outside the current user's audience", async () => {
    const accessQuery = { from: vi.fn(), where: vi.fn(), get: vi.fn() }
    accessQuery.from.mockReturnValue(accessQuery)
    accessQuery.where.mockReturnValue(accessQuery)
    accessQuery.get.mockResolvedValue(null)
    const insert = vi.fn()
    mocks.getDb.mockReturnValue({
      select: vi.fn().mockReturnValue(accessQuery),
      insert,
    })

    const result = await markCherishStoryViewed({ id: "someone-elses-story" })

    expect(result).toEqual({
      success: false,
      error: "This CHERISH story is no longer available.",
    })
    expect(insert).not.toHaveBeenCalled()
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
    const insertQuery = { values: vi.fn(), run: vi.fn() }
    insertQuery.values.mockReturnValue(insertQuery)
    insertQuery.run.mockResolvedValue(undefined)
    const notificationUpdate = {
      set: vi.fn(),
      where: vi.fn(),
      run: vi.fn(),
    }
    notificationUpdate.set.mockReturnValue(notificationUpdate)
    notificationUpdate.where.mockReturnValue(notificationUpdate)
    notificationUpdate.run.mockResolvedValue(undefined)
    mocks.getDb.mockReturnValue({
      select: vi.fn().mockReturnValue(accessQuery),
      insert: vi.fn().mockReturnValue(insertQuery),
      update: vi.fn().mockReturnValue(notificationUpdate),
    })

    const result = await sendCherishStoryReply({
      id: "story-1",
      message: "This made my day too.",
    })

    expect(result.success).toBe(true)
    expect(insertQuery.values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "message-1",
        responseId: "story-1",
        authorId: "staff-1",
        recipientId: "author-1",
        message: "This made my day too.",
      }),
    )
    expect(mocks.createDirectMessage).toHaveBeenCalledWith(["author-1"])
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      channelId: "direct:author-1:staff-1",
      content: "CHERISH reply\n\nThis made my day too.",
    })
    expect(notificationUpdate.set).toHaveBeenCalledWith({
      eventType: "cherish.story_reply",
      title: "staff@example.com replied to your CHERISH",
      href: "/dashboard/conversations/direct%3Aauthor-1%3Astaff-1",
    })
  })

  it("does not save a reply when a direct conversation cannot be started", async () => {
    const accessQuery = { from: vi.fn(), where: vi.fn(), get: vi.fn() }
    accessQuery.from.mockReturnValue(accessQuery)
    accessQuery.where.mockReturnValue(accessQuery)
    accessQuery.get.mockResolvedValue({
      id: "story-1",
      recipientId: "author-1",
      recipientEmail: "author@example.com",
    })
    const insert = vi.fn()
    mocks.getDb.mockReturnValue({
      select: vi.fn().mockReturnValue(accessQuery),
      insert,
    })
    mocks.createDirectMessage.mockResolvedValue({
      success: false,
      error: "One or more team members were not found",
    })

    const result = await sendCherishStoryReply({
      id: "story-1",
      message: "Thank you!",
    })

    expect(result).toEqual({
      success: false,
      error: "Unable to start a private conversation with the sender.",
    })
    expect(insert).not.toHaveBeenCalled()
    expect(mocks.sendMessage).not.toHaveBeenCalled()
  })

  it("does not save a CHERISH reply when the private message fails", async () => {
    const accessQuery = { from: vi.fn(), where: vi.fn(), get: vi.fn() }
    accessQuery.from.mockReturnValue(accessQuery)
    accessQuery.where.mockReturnValue(accessQuery)
    accessQuery.get.mockResolvedValue({
      id: "story-1",
      recipientId: "author-1",
      recipientEmail: "author@example.com",
    })

    const insert = vi.fn()
    mocks.getDb.mockReturnValue({
      select: vi.fn().mockReturnValue(accessQuery),
      insert,
    })
    mocks.sendMessage.mockResolvedValue({
      success: false,
      error: "Failed to send message",
    })

    const result = await sendCherishStoryReply({
      id: "story-1",
      message: "This made my day too.",
    })

    expect(result).toEqual({
      success: false,
      error: "Unable to send this reply as a private message.",
    })
    expect(insert).not.toHaveBeenCalled()
  })

  it("removes the private message when CHERISH reply persistence fails", async () => {
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
    insertQuery.run.mockRejectedValue(new Error("storage unavailable"))
    const notificationUpdate = {
      set: vi.fn(),
      where: vi.fn(),
      run: vi.fn(),
    }
    notificationUpdate.set.mockReturnValue(notificationUpdate)
    notificationUpdate.where.mockReturnValue(notificationUpdate)
    notificationUpdate.run.mockResolvedValue(undefined)
    mocks.getDb.mockReturnValue({
      select: vi.fn().mockReturnValue(accessQuery),
      insert: vi.fn().mockReturnValue(insertQuery),
      update: vi.fn().mockReturnValue(notificationUpdate),
    })

    const result = await sendCherishStoryReply({
      id: "story-1",
      message: "This made my day too.",
    })

    expect(result).toEqual({
      success: false,
      error: "Unable to finish sending this reply. Please try again.",
    })
    expect(mocks.deleteMessage).toHaveBeenCalledWith("message-1")
    expect(notificationUpdate.set).toHaveBeenCalledWith({
      title: "CHERISH reply not sent",
      body: "This reply could not be delivered.",
    })
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
    expect(mocks.sendMessage).not.toHaveBeenCalled()
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
    expect(mocks.deleteMessage).toHaveBeenCalledWith("reply-1")
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
