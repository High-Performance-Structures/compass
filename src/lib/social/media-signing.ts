function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

async function signature(input: {
  readonly photoId: string
  readonly expires: number
  readonly key: string
}): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(input.key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signed = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(`${input.photoId}:${input.expires}`),
  )
  return bytesToBase64Url(new Uint8Array(signed))
}

export async function createSignedSocialPhotoUrl(input: {
  readonly baseUrl: string
  readonly photoId: string
  readonly key: string
  readonly lifetimeSeconds?: number
}): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + (input.lifetimeSeconds ?? 15 * 60)
  const token = await signature({ photoId: input.photoId, expires, key: input.key })
  const url = new URL(`/api/social/media/${encodeURIComponent(input.photoId)}`, input.baseUrl)
  url.searchParams.set("expires", String(expires))
  url.searchParams.set("signature", token)
  return url.toString()
}

export async function verifySignedSocialPhoto(input: {
  readonly photoId: string
  readonly expires: string | null
  readonly providedSignature: string | null
  readonly key: string
}): Promise<boolean> {
  if (!input.expires || !input.providedSignature || !/^\d+$/.test(input.expires)) return false
  const expires = Number(input.expires)
  if (!Number.isSafeInteger(expires) || expires < Math.floor(Date.now() / 1000)) return false
  if (expires > Math.floor(Date.now() / 1000) + 30 * 60) return false
  const expected = await signature({ photoId: input.photoId, expires, key: input.key })
  if (expected.length !== input.providedSignature.length) return false
  let mismatch = 0
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ input.providedSignature.charCodeAt(index)
  }
  return mismatch === 0
}
