import { describe, expect, it } from "vitest"

import { gotoConversationDeleteUrl } from "@/lib/goto/conversation-url"

describe("gotoConversationDeleteUrl", () => {
  it("uses normalized E.164 phone numbers", () => {
    const result = gotoConversationDeleteUrl({
      ownerPhoneNumber: "719-686-0770",
      contactPhoneNumber: "(719) 555-0123",
    })

    expect(result?.toString()).toBe(
      "https://api.goto.com/messaging/v1/conversations?ownerPhoneNumber=%2B17196860770&contactPhoneNumber=%2B17195550123"
    )
  })

  it("rejects an invalid phone number", () => {
    const result = gotoConversationDeleteUrl({
      ownerPhoneNumber: "unknown",
      contactPhoneNumber: "+17195550123",
    })

    expect(result).toBeNull()
  })
})
