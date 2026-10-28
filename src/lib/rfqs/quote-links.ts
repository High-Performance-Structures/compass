/**
 * Secure no-login price links for RFQ recipients. The token is 32 random
 * bytes (base64url); only its SHA-256 hash is stored, so a database read
 * can't be turned back into a working link.
 */

export const QUOTE_LINK_PATH = "/quote"

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

function base64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
}

export function newQuoteLinkToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return base64Url(bytes)
}

export function isQuoteLinkTokenShape(token: string): boolean {
  return TOKEN_PATTERN.test(token)
}

export async function hashQuoteLinkToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

/**
 * When a link stops working: the end of the quote due date plus the grace
 * days, or a set number of days after sending when there's no due date.
 */
export function quoteLinkExpiresAt(input: {
  readonly now: Date
  readonly dueDate: string | null
  readonly graceDays: number
  readonly daysWithoutDueDate: number
}): string {
  const day = 24 * 60 * 60 * 1000
  const due = input.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) ? new Date(`${input.dueDate}T23:59:59Z`) : null
  const fromDue = due && !Number.isNaN(due.getTime()) ? due.getTime() + input.graceDays * day : null
  // A due date already past still leaves the grace period from today.
  const floor = input.now.getTime() + input.graceDays * day
  const expires = fromDue === null ? input.now.getTime() + input.daysWithoutDueDate * day : Math.max(fromDue, floor)
  return new Date(expires).toISOString()
}

export function quoteLinkIsLive(link: { readonly expiresAt: string; readonly revokedAt: string | null }, now: Date): boolean {
  return link.revokedAt === null && new Date(link.expiresAt).getTime() > now.getTime()
}
