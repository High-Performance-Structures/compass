// in-memory token cache keyed by user email.
// NOTE: in cloudflare workers, this resets per request since
// each request runs in its own isolate. for now we just
// generate tokens per-request (they're fast ~100ms).
// if perf becomes an issue, swap to KV-backed cache.

type CachedToken = {
  readonly accessToken: string
  readonly expiresAt: number
}

const TOKEN_BUFFER_MS = 5 * 60 * 1000 // refresh 5 min early

const cache = new Map<string, CachedToken>()

export function getCachedToken(
  userEmail: string
): string | null {
  const entry = cache.get(userEmail)
  if (!entry) return null
  if (Date.now() >= entry.expiresAt) {
    cache.delete(userEmail)
    return null
  }
  return entry.accessToken
}

export function setCachedToken(
  userEmail: string,
  accessToken: string,
  expiresInSeconds: number
): void {
  cache.set(userEmail, {
    accessToken,
    expiresAt:
      Date.now() + expiresInSeconds * 1000 - TOKEN_BUFFER_MS,
  })
}

export function clearCachedToken(userEmail: string): void {
  cache.delete(userEmail)
}
