import { describe, expect, it } from "vitest"

import {
  directChannelId,
  directParticipantIds,
} from "@/lib/conversations/direct-channel"

describe("direct conversation identity", () => {
  it("deduplicates and sorts the complete participant set", () => {
    expect(directParticipantIds("user-b", ["user-c", "user-a", "user-c"])).toEqual([
      "user-a",
      "user-b",
      "user-c",
    ])
  })

  it("uses the same channel for the same participants in any order", async () => {
    const first = await directChannelId("org-1", ["user-a", "user-b", "user-c"])
    const second = await directChannelId("org-1", ["user-c", "user-a", "user-b"])

    expect(second).toBe(first)
  })

  it("keeps different private groups in different channels", async () => {
    const first = await directChannelId("org-1", ["user-a", "user-b"])
    const second = await directChannelId("org-1", ["user-a", "user-b", "user-c"])

    expect(second).not.toBe(first)
  })
})
