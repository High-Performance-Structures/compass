import "server-only"

import { isRecord } from "@/lib/shared/guards"
import { emailRetryAt, isEmailRateLimit } from "./delivery-recovery"
import { base64UrlDecodeBytes, isSignatureImage, type InboundAttachment, type InboundCandidate } from "./gmail-message-parser"

/** Gmail API reads shared by the inbox poller and the Staff Message Desk. */

function isGmailAttachmentResponse(value: unknown): value is {
  readonly data: string
  readonly size?: number
} {
  return (
    isRecord(value) &&
    typeof value.data === "string" &&
    (value.size === undefined || typeof value.size === "number")
  )
}

export class GmailRateLimitError extends Error {
  constructor(readonly retryAt: string) {
    super(`Gmail is temporarily rate limited. Retry after ${retryAt}`)
  }
}

export async function fetchGmailJson(input: {
  readonly url: string
  readonly accessToken: string
}): Promise<unknown> {
  const response = await fetch(input.url, {
    signal: AbortSignal.timeout(20_000),
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
    },
  })
  const text = await response.text()
  if (isEmailRateLimit(response.status, text)) {
    throw new GmailRateLimitError(emailRetryAt({ error: text, retryAfter: response.headers.get("Retry-After"), now: new Date(), attempt: 0 }))
  }
  if (!response.ok) {
    throw new Error(`Gmail request failed (${response.status}): ${text}`)
  }
  if (text.length === 0) return null
  return JSON.parse(text)
}

export async function hydrateCandidateAttachments(input: {
  readonly candidate: InboundCandidate
  readonly accessToken: string
}): Promise<InboundCandidate> {
  const attachments: InboundAttachment[] = []
  // One file at a time keeps a large email's encoded and decoded copies from piling up in memory.
  for (const attachment of input.candidate.attachments) {
    // Signature logos are dropped here so every route (messages, daily logs, trade docs) sees the same files.
    if (isSignatureImage(attachment)) continue
    if (attachment.data || !attachment.attachmentId) {
      attachments.push(attachment)
      continue
    }
    const attachmentUrl = new URL(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${input.candidate.gmailMessageId}/attachments/${attachment.attachmentId}`
    )
    const response = await fetchGmailJson({
      url: attachmentUrl.toString(),
      accessToken: input.accessToken,
    })
    if (!isGmailAttachmentResponse(response)) {
      throw new Error(
        `Gmail returned an unexpected attachment for ${attachment.fileName}.`
      )
    }
    attachments.push({
      ...attachment,
      size: attachment.size ?? response.size ?? null,
      data: base64UrlDecodeBytes(response.data),
    })
  }
  return { ...input.candidate, attachments }
}
