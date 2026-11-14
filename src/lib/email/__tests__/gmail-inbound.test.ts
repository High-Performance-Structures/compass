import { describe, expect, it, vi } from "vitest"

import {
  candidateFromMessage,
  type InboundCandidate,
} from "@/lib/email/gmail-message-parser"
import { isReplyMessage } from "@/lib/email/reply-detection"
import { hydrateCandidateAttachments } from "@/lib/email/gmail-fetch"

vi.mock("server-only", () => ({}))

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
    automatic: null,
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
  it("keeps a project alias ahead of the final Gmail delivery mailbox", () => {
    const result = candidateFromMessage({
      id: "message-with-project-alias",
      payload: {
        headers: [
          {
            name: "To",
            value: "jarvis+project-proj-h-office@hps-colorado.com",
          },
          { name: "Delivered-To", value: "jarvis@hps-colorado.com" },
          { name: "Subject", value: "[RFI] Office question" },
        ],
      },
    })

    expect(result.toAddress).toBe(
      "jarvis+project-proj-h-office@hps-colorado.com"
    )
  })

  it("finds a project alias on the Cc line", () => {
    const result = candidateFromMessage({
      id: "message-with-cc-project-alias",
      payload: { headers: [
        { name: "To", value: "Client <client@example.com>" },
        { name: "Cc", value: "jarvis+project-proj-o-138@hps-colorado.com" },
        { name: "Delivered-To", value: "jarvis@hps-colorado.com" },
        { name: "Subject", value: "Fw: Inspection received" },
      ] },
    })
    expect(result.toAddress).toBe("jarvis+project-proj-o-138@hps-colorado.com")
  })

  it("keeps a tracked reply address when forwarding rewrites X-Original-To", () => {
    const result = candidateFromMessage({
      id: "tracked-reply",
      payload: { headers: [
        { name: "X-Original-To", value: "jarvis@hps-colorado.com" },
        { name: "To", value: "jarvis+cmp-0123456789abcdef12@hps-colorado.com" },
        { name: "Subject", value: "Re: Project update" },
      ] },
    })
    expect(result.token).toBe("cmp-0123456789abcdef12")
    expect(result.toAddress).toBe("jarvis+cmp-0123456789abcdef12@hps-colorado.com")
  })

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
        embedded: false,
      },
    ])
  })

  it("marks pictures shown inside the email body as embedded", () => {
    const result = candidateFromMessage({
      id: "message-with-logo",
      payload: {
        headers: [{ name: "From", value: "Sylvi <sylvi@example.com>" }, { name: "Subject", value: "Fw: inspection" }],
        parts: [
          { filename: "image001.png", mimeType: "image/png", headers: [{ name: "Content-ID", value: "<image001.png@01DB>" }, { name: "Content-Disposition", value: "inline; filename=\"image001.png\"" }], body: { attachmentId: "logo", size: 39636 } },
          { filename: "report.pdf", mimeType: "application/pdf", headers: [{ name: "Content-Disposition", value: "attachment; filename=\"report.pdf\"" }], body: { attachmentId: "report", size: 90000 } },
        ],
      },
    })
    expect(result.attachments.map((file) => [file.fileName, file.embedded])).toEqual([["image001.png", true], ["report.pdf", false]])
  })

  it("flags out-of-office replies and bounces, not other machine-sent mail", () => {
    const message = (headers: readonly { readonly name: string; readonly value: string }[]): string | null =>
      candidateFromMessage({ id: "m", payload: { headers: [{ name: "From", value: "Client <client@example.com>" }, ...headers] } }).automatic
    expect(message([{ name: "Auto-Submitted", value: "auto-replied" }])).toBe("out_of_office")
    expect(message([{ name: "X-Autoreply", value: "yes" }])).toBe("out_of_office")
    expect(message([{ name: "Auto-Submitted", value: "auto-generated" }])).toBeNull()
    expect(message([{ name: "Auto-Submitted", value: "no" }])).toBeNull()
    expect(message([{ name: "Precedence", value: "bulk" }])).toBeNull()
    expect(candidateFromMessage({ id: "m", payload: { headers: [{ name: "From", value: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>" }] } }).automatic).toBe("bounce")
    expect(message([])).toBeNull()
  })

  it("drops signature logos before any route sees the files", async () => {
    const bytes = (size: number): Uint8Array<ArrayBuffer> => new Uint8Array(size)
    const candidate = candidateFromMessage({ id: "m", payload: { headers: [{ name: "From", value: "Field <field@example.com>" }, { name: "Subject", value: "[DAILY LOG]" }] } })
    const hydrated = await hydrateCandidateAttachments({ accessToken: "token", candidate: { ...candidate, attachments: [
      { attachmentId: null, fileName: "image001.png", mimeType: "image/png", size: 39_636, data: bytes(39_636), embedded: true },
      { attachmentId: null, fileName: "IMG_1.jpeg", mimeType: "image/jpeg", size: 80_000, data: bytes(80_000), embedded: true },
      { attachmentId: null, fileName: "site.jpg", mimeType: "image/jpeg", size: 10, data: bytes(10), embedded: false },
    ] } })
    expect(hydrated.attachments.map((file) => file.fileName)).toEqual(["IMG_1.jpeg", "site.jpg"])
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
