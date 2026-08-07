import { describe, expect, it } from "vitest"

import {
  candidateFromMessage,
  type InboundCandidate,
} from "@/lib/email/gmail-message-parser"
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
    attachments: [],
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

describe("candidateFromMessage attachments", () => {
  it("captures a Gmail attachment reference for later download", () => {
    const result = candidateFromMessage({
      id: "message-with-photo",
      payload: {
        headers: [
          { name: "From", value: "Martine <martine@example.com>" },
          { name: "To", value: "jarvis+project-proj-h-office@hps-colorado.com" },
          { name: "Subject", value: "[Daily Log]" },
        ],
        parts: [
          {
            filename: "IMG_6737.jpeg",
            mimeType: "image/jpeg",
            body: { attachmentId: "attachment-1", size: 2048 },
          },
        ],
      },
    })

    expect(result.attachments).toEqual([
      {
        attachmentId: "attachment-1",
        fileName: "IMG_6737.jpeg",
        mimeType: "image/jpeg",
        size: 2048,
        data: null,
      },
    ])
  })

  it("decodes attachment data included directly in a Gmail part", () => {
    const result = candidateFromMessage({
      id: "message-with-inline-data",
      payload: {
        parts: [
          {
            filename: "note.txt",
            mimeType: "text/plain",
            body: { data: "cGhvdG8=" },
          },
        ],
      },
    })

    expect(Array.from(result.attachments[0]?.data ?? [])).toEqual([
      112, 104, 111, 116, 111,
    ])
  })
})
