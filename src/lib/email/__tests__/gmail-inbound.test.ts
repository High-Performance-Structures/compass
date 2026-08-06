import { describe, expect, it } from "vitest"

import type { InboundCandidate } from "@/lib/email/gmail-message-parser"
import { isReplyMessage } from "@/lib/email/reply-detection"

function candidate(
  overrides: Partial<InboundCandidate> = {}
): InboundCandidate {
  return {
    gmailMessageId: "message-1",
    gmailThreadId: "thread-1",
    messageIdHeader: "<message-1@example.com>",
    inReplyToHeader: null,
    referencesHeader: null,
    token: "cmp-1234567890",
    fromAddress: "person@example.com",
    fromName: "Person",
    toAddress: "jarvis+cmp-1234567890@hps-colorado.com",
    subject: "[O-210-33-RFI-001] Testing RFI feature",
    textBody: "Original outbound message",
    htmlBody: null,
    snippet: "Original outbound message",
    receivedAt: "2026-08-06T22:19:12.000Z",
    ...overrides,
  }
}

describe("isReplyMessage", () => {
  it("does not treat the original outbound copy as a reply", () => {
    expect(isReplyMessage(candidate())).toBe(false)
  })

  it("recognizes a reply using the In-Reply-To header", () => {
    expect(
      isReplyMessage(
        candidate({ inReplyToHeader: "<original-message@example.com>" })
      )
    ).toBe(true)
  })

  it("recognizes a reply by its subject when clients omit reply headers", () => {
    expect(
      isReplyMessage(candidate({ subject: "Re: [O-210-33-RFI-001] Testing" }))
    ).toBe(true)
  })
})
