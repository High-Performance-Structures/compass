import { describe, expect, it } from "vitest"
import {
  areArchiveUserMentionsInternal,
  canAccessConversationChannel,
  canCreateConversationMessage,
  isBuildertrendArchiveChannelId,
  isReplyInConversationChannel,
} from "../channel-access"

const archiveChannelId = "bt-message-archive-5072748"

describe("canAccessConversationChannel", () => {
  it("allows an internal staff member to continue a public staff archive without a membership row", () => {
    expect(
      canAccessConversationChannel({
        channelId: archiveChannelId,
        hasMembership: false,
        isPrivate: false,
        audience: "staff",
        role: "project_manager",
      })
    ).toBe(true)
  })

  it("does not grant a public staff archive to an external user without membership", () => {
    expect(
      canAccessConversationChannel({
        channelId: archiveChannelId,
        hasMembership: false,
        isPrivate: false,
        audience: "staff",
        role: "client",
      })
    ).toBe(false)
  })

  it("continues to honor explicit channel membership for any audience", () => {
    expect(
      canAccessConversationChannel({
        channelId: "project-owner-123",
        hasMembership: true,
        isPrivate: true,
        audience: "clients",
        role: "client",
      })
    ).toBe(true)
  })

  it("does not widen ordinary public staff channels without membership", () => {
    expect(
      canAccessConversationChannel({
        channelId: "project-staff-123",
        hasMembership: false,
        isPrivate: false,
        audience: "staff",
        role: "project_manager",
      })
    ).toBe(false)
  })
})

describe("isBuildertrendArchiveChannelId", () => {
  it("recognizes only the imported Buildertrend archive channel namespace", () => {
    expect(isBuildertrendArchiveChannelId(archiveChannelId)).toBe(true)
    expect(isBuildertrendArchiveChannelId("project-team-5072748")).toBe(false)
  })
})

describe("canCreateConversationMessage", () => {
  it("requires a Buildertrend archive continuation to name a parent message", () => {
    expect(
      canCreateConversationMessage({ channelId: archiveChannelId, threadId: undefined })
    ).toBe(false)
    expect(
      canCreateConversationMessage({ channelId: archiveChannelId, threadId: "parent-message" })
    ).toBe(true)
  })

  it("keeps ordinary conversation root posts available", () => {
    expect(
      canCreateConversationMessage({ channelId: "project-staff-123", threadId: undefined })
    ).toBe(true)
  })
})

describe("areArchiveUserMentionsInternal", () => {
  it("only permits internal teammates to receive direct mentions in an archive", () => {
    expect(
      areArchiveUserMentionsInternal({
        channelId: archiveChannelId,
        mentionedUserIds: ["staff-user"],
        internalUserIds: new Set(["staff-user"]),
      })
    ).toBe(true)
    expect(
      areArchiveUserMentionsInternal({
        channelId: archiveChannelId,
        mentionedUserIds: ["external-user"],
        internalUserIds: new Set(["staff-user"]),
      })
    ).toBe(false)
  })

  it("does not change direct mention behavior for ordinary channels", () => {
    expect(
      areArchiveUserMentionsInternal({
        channelId: "project-staff-123",
        mentionedUserIds: ["external-user"],
        internalUserIds: new Set(),
      })
    ).toBe(true)
  })
})

describe("isReplyInConversationChannel", () => {
  it("keeps a reply attached to its top-level Buildertrend archive message", () => {
    expect(
      isReplyInConversationChannel({
        channelId: archiveChannelId,
        parentChannelId: archiveChannelId,
        parentThreadId: null,
      })
    ).toBe(true)
  })

  it("rejects a missing, cross-channel, or nested-thread reply target", () => {
    expect(
      isReplyInConversationChannel({
        channelId: archiveChannelId,
        parentChannelId: null,
        parentThreadId: null,
      })
    ).toBe(false)
    expect(
      isReplyInConversationChannel({
        channelId: archiveChannelId,
        parentChannelId: "another-channel",
        parentThreadId: null,
      })
    ).toBe(false)
    expect(
      isReplyInConversationChannel({
        channelId: archiveChannelId,
        parentChannelId: archiveChannelId,
        parentThreadId: "existing-parent",
      })
    ).toBe(false)
  })
})
