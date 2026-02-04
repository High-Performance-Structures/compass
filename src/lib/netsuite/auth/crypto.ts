// AES-256-GCM encryption for OAuth tokens at rest in D1.
// uses Web Crypto API (available in Cloudflare Workers).

const ALGORITHM = "AES-GCM"
const KEY_LENGTH = 256
const IV_LENGTH = 12
const TAG_LENGTH = 128

async function deriveKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  )

  // static salt is fine here - the encryption key itself
  // is the secret, and each ciphertext gets a unique IV
  const salt = encoder.encode("compass-netsuite-tokens")

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
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
  secret: string
): Promise<string> {
  const key = await deriveKey(secret)
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const encoder = new TextEncoder()

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv, tagLength: TAG_LENGTH },
    key,
    encoder.encode(plaintext)
  )

  // pack as iv:ciphertext in base64
  const packed = new Uint8Array(iv.length + ciphertext.byteLength)
  packed.set(iv)
  packed.set(new Uint8Array(ciphertext), iv.length)

  return btoa(String.fromCharCode(...packed))
}

export async function decrypt(
  encoded: string,
  secret: string
): Promise<string> {
  const key = await deriveKey(secret)

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
