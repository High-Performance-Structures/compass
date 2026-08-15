import { describe, expect, it } from "vitest"

import { parseRetrievedGotoMessage } from "@/lib/goto/message-recovery"

describe("parseRetrievedGotoMessage", () => {
  it("reads a direct GoTo message response", () => {
    expect(
      parseRetrievedGotoMessage({
        id: "message-1",
        body: "[RFI] Please verify the opening.",
        conversationId: "conversation-1",
      })
    ).toEqual({
      body: "[RFI] Please verify the opening.",
      conversationId: "conversation-1",
    })
  })

  it("accepts nested message and collection response shapes", () => {
    expect(
      parseRetrievedGotoMessage({
        message: { body: "Nested text", conversationId: "conversation-2" },
      })
    ).toEqual({ body: "Nested text", conversationId: "conversation-2" })
    expect(
      parseRetrievedGotoMessage({ items: [{ body: "Listed text" }] })
    ).toEqual({ body: "Listed text", conversationId: null })
  })

  it("rejects responses without retained text", () => {
    expect(parseRetrievedGotoMessage({ id: "message-1" })).toBeNull()
    expect(parseRetrievedGotoMessage({ body: "   " })).toBeNull()
    expect(parseRetrievedGotoMessage(null)).toBeNull()
  })
})
