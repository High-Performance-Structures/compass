import { describe, expect, it } from "vitest"

import {
  createSignedSocialPhotoUrl,
  verifySignedSocialPhoto,
} from "@/lib/social/media-signing"

describe("signed social photo URLs", () => {
  it("accepts an untampered short-lived URL", async () => {
    const url = new URL(await createSignedSocialPhotoUrl({
      baseUrl: "https://compass.example.com",
      photoId: "photo-123",
      key: "test-signing-key-with-enough-entropy",
      lifetimeSeconds: 60,
    }))
    await expect(verifySignedSocialPhoto({
      photoId: "photo-123",
      expires: url.searchParams.get("expires"),
      providedSignature: url.searchParams.get("signature"),
      key: "test-signing-key-with-enough-entropy",
    })).resolves.toBe(true)
  })

  it("rejects a token used for another photo", async () => {
    const url = new URL(await createSignedSocialPhotoUrl({
      baseUrl: "https://compass.example.com",
      photoId: "photo-123",
      key: "test-signing-key-with-enough-entropy",
      lifetimeSeconds: 60,
    }))
    await expect(verifySignedSocialPhoto({
      photoId: "photo-456",
      expires: url.searchParams.get("expires"),
      providedSignature: url.searchParams.get("signature"),
      key: "test-signing-key-with-enough-entropy",
    })).resolves.toBe(false)
  })
})
