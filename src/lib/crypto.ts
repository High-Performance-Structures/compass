// shared AES-256-GCM encryption for secrets at rest in D1.
// uses Web Crypto API (available in Cloudflare Workers).

const ALGORITHM = "AES-GCM"
const KEY_LENGTH = 256
const IV_LENGTH = 12
const TAG_LENGTH = 128

// Deriving the AES key runs 100,000 PBKDF2 rounds, which is a noticeable chunk
// of CPU. Routes that decrypt the same secret on every request (for example the
// Google service-account key behind every photo download) would repeat that
// work hundreds of times a minute, so each isolate keeps the derived key for
// its lifetime. The key is non-extractable and never leaves this module.
const MAX_CACHED_DERIVED_KEYS = 16
const derivedKeyCache = new Map<string, Promise<CryptoKey>>()

function deriveKey(secret: string, salt: string): Promise<CryptoKey> {
  const cacheKey = `${salt}\u0000${secret}`
  const cached = derivedKeyCache.get(cacheKey)
  if (cached) return cached
  if (derivedKeyCache.size >= MAX_CACHED_DERIVED_KEYS) derivedKeyCache.clear()
  const derived = deriveKeyUncached(secret, salt)
  derivedKeyCache.set(cacheKey, derived)
  // A failed derivation must not stay cached.
  void derived.catch(() => derivedKeyCache.delete(cacheKey))
  return derived
}

async function deriveKeyUncached(
  secret: string,
  salt: string
): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  )

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode(salt),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"]
  )
}

export async function encrypt(
  plaintext: string,
  secret: string,
  salt: string
): Promise<string> {
  const key = await deriveKey(secret, salt)
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const encoder = new TextEncoder()

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv, tagLength: TAG_LENGTH },
    key,
    encoder.encode(plaintext)
  )

  const packed = new Uint8Array(iv.length + ciphertext.byteLength)
  packed.set(iv)
  packed.set(new Uint8Array(ciphertext), iv.length)

  return btoa(String.fromCharCode(...packed))
}

export async function decrypt(
  encoded: string,
  secret: string,
  salt: string
): Promise<string> {
  const key = await deriveKey(secret, salt)

  const packed = Uint8Array.from(atob(encoded), c => c.charCodeAt(0))
  const iv = packed.slice(0, IV_LENGTH)
  const ciphertext = packed.slice(IV_LENGTH)

  const plaintext = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv, tagLength: TAG_LENGTH },
    key,
    ciphertext
  )

  return new TextDecoder().decode(plaintext)
}
