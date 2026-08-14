import { describe, expect, it } from "vitest"
import {
  canAccessConversationChannel,
  isBuildertrendArchiveChannelId,
  isReplyInConversationChannel,
} from "../channel-access"

describe("canAccessConversationChannel", () => {
  it("allows an internal staff member to continue a public staff archive without a membership row", () => {
    expect(
      canAccessConversationChannel({
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
        hasMembership: true,
        isPrivate: true,
        audience: "clients",
        role: "client",
      })
    ).toBe(true)
  })

  it("does not widen non-staff public channels without membership", () => {
    expect(
      canAccessConversationChannel({
        hasMembership: false,
        isPrivate: false,
        audience: "clients",
        role: "project_manager",
      })
    ).toBe(false)
  })
})

describe("isBuildertrendArchiveChannelId", () => {
  it("recognizes only the imported Buildertrend archive channel namespace", () => {
    expect(isBuildertrendArchiveChannelId("bt-message-archive-5072748")).toBe(true)
    expect(isBuildertrendArchiveChannelId("project-team-5072748")).toBe(false)
  })
})

describe("isReplyInConversationChannel", () => {
  it("keeps a reply attached to its top-level Buildertrend archive message", () => {
    expect(
      isReplyInConversationChannel({
        channelId: "bt-message-archive-5072748",
        parentChannelId: "bt-message-archive-5072748",
        parentThreadId: null,
      })
    ).toBe(true)
  })

  it("rejects a cross-channel or nested-thread reply target", () => {
    expect(
      isReplyInConversationChannel({
        channelId: "bt-message-archive-5072748",
        parentChannelId: "another-channel",
        parentThreadId: null,
      })
    ).toBe(false)
    expect(
      isReplyInConversationChannel({
        channelId: "bt-message-archive-5072748",
        parentChannelId: "bt-message-archive-5072748",
        parentThreadId: "existing-parent",
      })
    ).toBe(false)
  })
})
