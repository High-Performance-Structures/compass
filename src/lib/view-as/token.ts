/*
 * View as session token: `<base64url JSON payload>.<base64url HMAC-SHA256>`.
 * The cookie never holds a bare user id; a changed payload fails the
 * signature, and an expired one is refused. The token only says who started
 * viewing whom; every request still re-checks that the admin may use View as
 * (session.ts). Pure apart from Web Crypto, so it runs in tests and workers.
 */
import { isRecord } from "@/lib/shared/guards"

export type ViewAsTokenPayload = {
  readonly v: 1
  /** Ties the start and end Activity entries together. */
  readonly sid: string
  /** The signed-in admin who started viewing. */
  readonly adminId: string
  /** The person being viewed. */
  readonly targetId: string
  /** The admin's company when viewing started; the viewed person is seen through it. */
  readonly orgId: string
  /**
   * The viewed person's sign-in and Google emails, lower case, so the Google
   * delegation guard can refuse them without loading auth (delegation.ts).
   */
  readonly targetEmails: readonly string[]
  /** Seconds since the epoch. */
  readonly iat: number
  readonly exp: number
}

const encoder = new TextEncoder()

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function base64UrlDecode(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"))
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
  } catch {
    return null
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  // Domain-separate the shared server secret so a View as signature is never
  // valid for anything else signed with it.
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(`compass-view-as:v1:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  )
}

export async function signViewAsToken(payload: ViewAsTokenPayload, secret: string): Promise<string> {
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)))
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(body))
  return `${body}.${base64UrlEncode(new Uint8Array(signature))}`
}

function parsePayload(value: unknown): ViewAsTokenPayload | null {
  if (!isRecord(value)) return null
  const { v, sid, adminId, targetId, orgId, iat, exp, targetEmails } = value
  if (v !== 1) return null
  if (!Array.isArray(targetEmails) || !targetEmails.every((email): email is string => typeof email === "string")) return null
  if (typeof sid !== "string" || typeof adminId !== "string" || typeof targetId !== "string" || typeof orgId !== "string") return null
  if (typeof iat !== "number" || typeof exp !== "number") return null
  if (!sid || !adminId || !targetId || !orgId) return null
  return { v, sid, adminId, targetId, orgId, iat, exp, targetEmails }
}

/** The payload when the signature is valid and the session has not expired; otherwise null. */
export async function verifyViewAsToken(
  token: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  options: { readonly allowExpired?: boolean } = {},
): Promise<ViewAsTokenPayload | null> {
  const [body, signature, extra] = token.split(".")
  if (!body || !signature || extra !== undefined) return null
  const signatureBytes = base64UrlDecode(signature)
  const bodyBytes = base64UrlDecode(body)
  if (!signatureBytes || !bodyBytes) return null
  const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret), signatureBytes, encoder.encode(body))
  if (!valid) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(bodyBytes))
  } catch {
    return null
  }
  const payload = parsePayload(parsed)
  if (!payload) return null
  // Exit still records the end of a session that ran out; nothing else may.
  if (!options.allowExpired && (payload.exp <= nowSeconds || payload.iat > nowSeconds + 60)) return null
  return payload
}

/**
 * The viewed person's emails from a token, without checking the signature.
 * Only for refusing things (the Google delegation guard): a forged token can
 * add refusals, never permissions, and a forged session never resolves to
 * the viewed person anyway. Null when the token can't be read.
 */
export function unverifiedViewAsTargetEmails(token: string): readonly string[] | null {
  const body = base64UrlDecode(token.split(".")[0] ?? "")
  if (!body) return null
  try {
    const payload = parsePayload(JSON.parse(new TextDecoder().decode(body)))
    return payload ? payload.targetEmails : null
  } catch {
    return null
  }
}
