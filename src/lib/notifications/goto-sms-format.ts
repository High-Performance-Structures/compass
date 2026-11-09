import { isRecord } from "@/lib/shared/guards"

/** Small GoTo SMS helpers: account key, auth header, message text, provider id. */

export function gotoAccountKey(value: Readonly<Record<string, unknown>>): string | null {
  const field = value.account_key ?? value.accountKey
  if (typeof field === "string" && field.trim().length > 0) {
    return field.trim()
  }
  return typeof field === "number" && Number.isFinite(field)
    ? String(field)
    : null
}

export function toBasicAuthToken(clientId: string, clientSecret: string): string {
  return btoa(`${clientId}:${clientSecret}`)
}

export function notificationSmsBody(title: string, body: string): string {
  const message = `${title}\n${body}\nReply STOP to opt out.`.trim()
  return message.length > 1000
    ? `${message.slice(0, 997)}...`
    : message
}

export function extractProviderMessageId(value: unknown): string | null {
  if (!isRecord(value)) return null
  if (typeof value.id === "string") return value.id
  if (typeof value.messageId === "string") return value.messageId
  if (!Array.isArray(value.messages)) return null
  const firstMessage = value.messages[0]
  if (!isRecord(firstMessage)) return null
  return typeof firstMessage.id === "string" ? firstMessage.id : null
}
