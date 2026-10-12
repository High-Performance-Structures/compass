import type { PaperTrailRecordType } from "@/db/schema-paper-trail"
import { PAPER_TRAIL_RECORD_TYPES } from "@/db/schema-paper-trail"
import { getJarvisBridgeSecrets } from "@/lib/jarvis/auth"

/**
 * A short-lived pass that lets the PDF renderer open the record-copy print
 * page for exactly one record. It is signed with a key derived from the
 * maintenance secret for this purpose only, sent as a request header (not in
 * the URL), and expires after a few minutes.
 */
export const RECORD_COPY_TOKEN_HEADER = "x-compass-record-copy"
const TOKEN_TTL_SECONDS = 5 * 60
const PURPOSE = "compass-record-copy-v1"

export type RecordCopyGrant = {
  readonly recordType: PaperTrailRecordType
  readonly recordId: string
  readonly projectId: string
}

const encoder = new TextEncoder()

function base64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=")
  const binary = atob(padded)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

async function signingKey(secret: string): Promise<CryptoKey> {
  // Derive a purpose-bound key so this pass can never stand in for a
  // maintenance request signature, and vice versa.
  const derived = await crypto.subtle.digest("SHA-256", encoder.encode(`${PURPOSE}:${secret}`))
  return crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"])
}

export async function createRecordCopyToken(
  env: CloudflareEnv,
  grant: RecordCopyGrant,
  now = new Date(),
): Promise<string> {
  const secret = getJarvisBridgeSecrets(env)?.[0]
  if (!secret) throw new Error("Maintenance authentication is not configured.")
  return signRecordCopyToken(secret, grant, now)
}

export async function signRecordCopyToken(secret: string, grant: RecordCopyGrant, now = new Date()): Promise<string> {
  const payload = base64Url(
    encoder.encode(
      JSON.stringify({ t: grant.recordType, r: grant.recordId, p: grant.projectId, e: Math.floor(now.getTime() / 1000) + TOKEN_TTL_SECONDS }),
    ),
  )
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(secret), encoder.encode(payload)))
  return `${payload}.${base64Url(signature)}`
}

function isRecordType(value: unknown): value is PaperTrailRecordType {
  return typeof value === "string" && (PAPER_TRAIL_RECORD_TYPES as readonly string[]).includes(value)
}

/** The grant a valid, unexpired pass carries, or null. Accepts a rotated secondary secret. */
export async function verifyRecordCopyToken(
  env: CloudflareEnv,
  token: string | null | undefined,
  now = new Date(),
): Promise<RecordCopyGrant | null> {
  return checkRecordCopyToken(getJarvisBridgeSecrets(env) ?? [], token, now)
}

export async function checkRecordCopyToken(
  secrets: readonly string[],
  token: string | null | undefined,
  now = new Date(),
): Promise<RecordCopyGrant | null> {
  if (!token || token.length > 2048) return null
  const [payload, signature, extra] = token.split(".")
  if (!payload || !signature || extra !== undefined) return null
  let signatureBytes: Uint8Array<ArrayBuffer>
  try {
    signatureBytes = fromBase64Url(signature)
  } catch {
    return null
  }
  let valid = false
  for (const secret of secrets) {
    if (await crypto.subtle.verify("HMAC", await signingKey(secret), signatureBytes, encoder.encode(payload))) {
      valid = true
      break
    }
  }
  if (!valid) return null
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)))
    if (typeof parsed !== "object" || parsed === null) return null
    const recordType: unknown = Reflect.get(parsed, "t")
    const recordId: unknown = Reflect.get(parsed, "r")
    const projectId: unknown = Reflect.get(parsed, "p")
    const expires: unknown = Reflect.get(parsed, "e")
    if (!isRecordType(recordType) || typeof recordId !== "string" || typeof projectId !== "string" || typeof expires !== "number") {
      return null
    }
    if (expires < Math.floor(now.getTime() / 1000)) return null
    return { recordType, recordId, projectId }
  } catch {
    return null
  }
}
