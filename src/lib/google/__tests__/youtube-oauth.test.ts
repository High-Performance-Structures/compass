import { describe, expect, it } from "vitest"

import {
  YOUTUBE_OAUTH_SCOPES,
  hasRequiredYoutubeScopes,
} from "@/lib/google/youtube-oauth-scopes"

describe("YouTube OAuth scope validation", () => {
  it("accepts the requested YouTube scopes", () => {
    expect(hasRequiredYoutubeScopes([...YOUTUBE_OAUTH_SCOPES])).toBe(true)
  })

  it("accepts Google's canonical userinfo email scope", () => {
    expect(
      hasRequiredYoutubeScopes([
        "openid",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/youtube.readonly",
        "https://www.googleapis.com/auth/youtube.upload",
      ])
    ).toBe(true)
  })

  it("rejects a grant without YouTube upload access", () => {
    expect(
      hasRequiredYoutubeScopes([
        "openid",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/youtube.readonly",
      ])
    ).toBe(false)
  })
})
