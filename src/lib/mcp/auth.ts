import { eq, and, gte, sql } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import { mcpApiKeys, mcpUsage } from "@/db/schema-mcp"

const KEY_PREFIX = "ck_"
const KEY_RANDOM_BYTES = 20 // 20 bytes = 40 hex chars

export type ValidKeyResult =
  | Readonly<{
      valid: true
      userId: string
      scopes: ReadonlyArray<string>
      keyId: string
    }>
  | Readonly<{
      valid: false
      error: string
    }>

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let hex = ""
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0")
  }
  return hex
}

export async function hashApiKey(
  key: string
): Promise<string> {
  const encoded = new TextEncoder().encode(key)
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoded
  )
  return toHex(digest)
}

export function generateApiKey(): Readonly<{
  key: string
  keyPrefix: string
}> {
  const randomBytes = new Uint8Array(KEY_RANDOM_BYTES)
  crypto.getRandomValues(randomBytes)
  const hex = toHex(randomBytes.buffer)
  const key = `${KEY_PREFIX}${hex}`
  // prefix = first 8 chars for identification
  const keyPrefix = key.slice(0, 8)
  return { key, keyPrefix }
}

export async function validateApiKey(
  db: DrizzleD1Database<Record<string, unknown>>,
  rawKey: string
): Promise<ValidKeyResult> {
  const hash = await hashApiKey(rawKey)

  const row = await db
    .select()
    .from(mcpApiKeys)
    .where(
      and(
        eq(mcpApiKeys.keyHash, hash),
        eq(mcpApiKeys.isActive, true)
      )
    )
    .get()

  if (!row) {
    return { valid: false, error: "Invalid API key" }
  }

  // check expiry
  if (row.expiresAt) {
    const now = new Date()
    const expiry = new Date(row.expiresAt)
    if (now > expiry) {
      return { valid: false, error: "API key expired" }
    }
  }

  // update last used timestamp (fire-and-forget)
  const now = new Date().toISOString()
  db.update(mcpApiKeys)
    .set({ lastUsedAt: now })
    .where(eq(mcpApiKeys.id, row.id))
    .run()
    .catch(() => {
      // non-critical: best-effort timestamp update
    })

  let scopes: ReadonlyArray<string>
  try {
    const parsed: unknown = JSON.parse(row.scopes)
    if (!Array.isArray(parsed)) {
      return { valid: false, error: "invalid key data" }
    }
    scopes = parsed.filter(
      (s): s is string => typeof s === "string",
    )
  } catch {
    return { valid: false, error: "invalid key data" }
  }

  return {
    valid: true,
    userId: row.userId,
    scopes,
    keyId: row.id,
  }
}

export async function checkRateLimit(
  db: DrizzleD1Database<Record<string, unknown>>,
  keyId: string,
  windowMs = 60_000,
  maxRequests = 100,
): Promise<boolean> {
  const since = new Date(
    Date.now() - windowMs,
  ).toISOString()
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(mcpUsage)
    .where(
      and(
        eq(mcpUsage.apiKeyId, keyId),
        gte(mcpUsage.createdAt, since),
      ),
    )
    .get()
  return (rows?.count ?? 0) < maxRequests
}
