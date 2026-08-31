function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export type SocialPhotoVariant = "original" | "instagram"

export function socialPhotoVariant(value: string | null): SocialPhotoVariant | null {
  if (value === null || value === "original") return "original"
  if (value === "instagram") return value
  return null
}

async function signature(input: {
  readonly photoId: string
  readonly expires: number
  readonly variant: SocialPhotoVariant
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
    new TextEncoder().encode(
      input.variant === "original"
        ? `${input.photoId}:${input.expires}`
        : `${input.photoId}:${input.expires}:${input.variant}`,
    ),
  )
  return bytesToBase64Url(new Uint8Array(signed))
}

export async function createSignedSocialPhotoUrl(input: {
  readonly baseUrl: string
  readonly photoId: string
  readonly key: string
  readonly variant?: SocialPhotoVariant
  readonly lifetimeSeconds?: number
}): Promise<string> {
  const variant = input.variant ?? "original"
  const expires = Math.floor(Date.now() / 1000) + (input.lifetimeSeconds ?? 15 * 60)
  const token = await signature({
    photoId: input.photoId,
    expires,
    variant,
    key: input.key,
  })
  const url = new URL(`/api/social/media/${encodeURIComponent(input.photoId)}`, input.baseUrl)
  url.searchParams.set("expires", String(expires))
  if (variant !== "original") url.searchParams.set("variant", variant)
  url.searchParams.set("signature", token)
  return url.toString()
}

export async function verifySignedSocialPhoto(input: {
  readonly photoId: string
  readonly expires: string | null
  readonly providedSignature: string | null
  readonly variant?: SocialPhotoVariant
  readonly key: string
}): Promise<boolean> {
  if (!input.expires || !input.providedSignature || !/^\d+$/.test(input.expires)) return false
  const expires = Number(input.expires)
  if (!Number.isSafeInteger(expires) || expires < Math.floor(Date.now() / 1000)) return false
  if (expires > Math.floor(Date.now() / 1000) + 30 * 60) return false
  const expected = await signature({
    photoId: input.photoId,
    expires,
    variant: input.variant ?? "original",
    key: input.key,
  })
  if (expected.length !== input.providedSignature.length) return false
  let mismatch = 0
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ input.providedSignature.charCodeAt(index)
  }
  return mismatch === 0
}
