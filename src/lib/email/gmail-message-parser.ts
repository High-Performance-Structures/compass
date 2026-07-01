import "server-only"

type GmailHeader = {
  readonly name: string
  readonly value: string
}

type GmailBody = {
  readonly data?: string
}

type GmailPart = {
  readonly mimeType?: string
  readonly body?: GmailBody
  readonly parts?: readonly GmailPart[]
}

export type GmailMessage = {
  readonly id: string
  readonly threadId?: string
  readonly snippet?: string
  readonly internalDate?: string
  readonly payload?: GmailPart & {
    readonly headers?: readonly GmailHeader[]
  }
}

export type InboundCandidate = {
  readonly gmailMessageId: string
  readonly gmailThreadId: string | null
  readonly messageIdHeader: string | null
  readonly inReplyToHeader: string | null
  readonly referencesHeader: string | null
  readonly token: string | null
  readonly fromAddress: string
  readonly fromName: string | null
  readonly toAddress: string | null
  readonly subject: string
  readonly textBody: string | null
  readonly htmlBody: string | null
  readonly snippet: string | null
  readonly receivedAt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function isGmailMessage(value: unknown): value is GmailMessage {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.threadId === undefined || typeof value.threadId === "string")
  )
}

function base64UrlDecode(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/")
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "="
  )
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new TextDecoder().decode(bytes)
}

function headersByName(headers: readonly GmailHeader[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const header of headers) {
    map.set(header.name.toLowerCase(), header.value)
  }
  return map
}

function collectBodies(part: GmailPart | undefined): {
  readonly text: readonly string[]
  readonly html: readonly string[]
} {
  if (!part) return { text: [], html: [] }

  const childBodies = (part.parts ?? []).map(collectBodies)
  const text = childBodies.flatMap((child) => child.text)
  const html = childBodies.flatMap((child) => child.html)

  if (part.body?.data) {
    try {
      const decoded = base64UrlDecode(part.body.data)
      if (part.mimeType === "text/html") {
        return { text, html: [...html, decoded] }
      }
      if (part.mimeType === "text/plain" || !part.mimeType) {
        return { text: [...text, decoded], html }
      }
    } catch {
      return { text, html }
    }
  }

  return { text, html }
}

export function stripHtml(html: string): string {
  return html
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function extractToken(value: string): string | null {
  const match = /\bcmp-[a-z0-9]{10,40}\b/i.exec(value)
  return match ? match[0].toLowerCase() : null
}

function parseAddress(value: string | null): {
  readonly name: string | null
  readonly email: string
} {
  if (!value) return { name: null, email: "unknown@example.invalid" }
  const match = /^(?:"?([^"<]*)"?\s*)?<([^<>]+)>$/.exec(value.trim())
  if (match) {
    const name = match[1]?.trim()
    return {
      name: name && name.length > 0 ? name : null,
      email: match[2].trim().toLowerCase(),
    }
  }
  return { name: null, email: value.trim().toLowerCase() }
}

function messageDate(internalDate: string | undefined): string {
  if (!internalDate) return new Date().toISOString()
  const millis = Number.parseInt(internalDate, 10)
  if (!Number.isFinite(millis)) return new Date().toISOString()
  return new Date(millis).toISOString()
}

export function candidateFromMessage(message: GmailMessage): InboundCandidate {
  const headers = headersByName(message.payload?.headers ?? [])
  const bodies = collectBodies(message.payload)
  const textBody = bodies.text.join("\n\n").trim()
  const htmlBody = bodies.html.join("\n\n").trim()
  const searchable = [
    headers.get("x-compass-reply-token") ?? "",
    headers.get("to") ?? "",
    headers.get("cc") ?? "",
    headers.get("subject") ?? "",
    textBody,
    htmlBody,
    message.snippet ?? "",
  ].join("\n")
  const from = parseAddress(headers.get("from") ?? null)

  return {
    gmailMessageId: message.id,
    gmailThreadId: message.threadId ?? null,
    messageIdHeader: headers.get("message-id") ?? null,
    inReplyToHeader: headers.get("in-reply-to") ?? null,
    referencesHeader: headers.get("references") ?? null,
    token: extractToken(searchable),
    fromAddress: from.email,
    fromName: from.name,
    toAddress: headers.get("to") ?? null,
    subject: headers.get("subject") ?? "(no subject)",
    textBody: textBody.length > 0 ? textBody : null,
    htmlBody: htmlBody.length > 0 ? htmlBody : null,
    snippet: message.snippet ?? null,
    receivedAt: messageDate(message.internalDate),
  }
}
