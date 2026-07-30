import { describe, expect, it } from "vitest"

import { importedConversationContent } from "@/lib/conversations/imported-message-content"

describe("imported conversation content", () => {
  it("replaces Buildertrend archive links with a durable Compass note", () => {
    expect(
      importedConversationContent({
        id: "bt-owner-history-35400494-123",
        content:
          "**Selections**\n\nArchived message text.\n\n" +
          "[Open original in Buildertrend](https://buildertrend.net/app/Message/Inbox/123)",
      })
    ).toBe(
      "**Selections**\n\nArchived message text.\n\n" +
        "_Buildertrend archive excerpt stored in Compass._"
    )
  })

  it("does not rewrite ordinary Compass messages", () => {
    const content =
      "Reference: [Buildertrend](https://buildertrend.net/app/Message/Inbox/123)"
    expect(
      importedConversationContent({
        id: "compass-message-123",
        content,
      })
    ).toBe(content)
  })
})
