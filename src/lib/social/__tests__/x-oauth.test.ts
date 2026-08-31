import { afterEach, describe, expect, it, vi } from "vitest"

import { refreshXAccessToken } from "@/lib/social/x"

vi.mock("server-only", () => ({}))

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function requestBody(init: RequestInit | undefined): URLSearchParams {
  if (!(init?.body instanceof URLSearchParams)) {
    throw new Error("Expected an OAuth form body.")
  }
  return init.body
}

function requestHeaders(init: RequestInit | undefined): Headers {
  return new Headers(init?.headers)
}

describe("X OAuth refresh", () => {
  it("uses only Basic authentication for a confidential client", async () => {
    const fetchMock = vi.fn(async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      expect(requestHeaders(init).get("Authorization")).toBe("Basic Y2xpZW50OnNlY3JldA==")
      const body = requestBody(init)
      expect(body.get("client_id")).toBeNull()
      expect(body.get("grant_type")).toBe("refresh_token")
      expect(body.get("refresh_token")).toBe("refresh-token")
      return Response.json({
        access_token: "access-token",
        refresh_token: "next-refresh-token",
        expires_in: 7200,
        scope: "tweet.read tweet.write offline.access",
      })
    })
    globalThis.fetch = fetchMock

    const result = await refreshXAccessToken({
      clientId: "client",
      clientSecret: "secret",
      refreshToken: "refresh-token",
    })

    expect(result.accessToken).toBe("access-token")
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("sends client_id in the form for a public client", async () => {
    globalThis.fetch = vi.fn(async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      expect(requestHeaders(init).has("Authorization")).toBe(false)
      expect(requestBody(init).get("client_id")).toBe("public-client")
      return Response.json({ access_token: "access-token", expires_in: 7200 })
    })

    await refreshXAccessToken({
      clientId: "public-client",
      clientSecret: null,
      refreshToken: "refresh-token",
    })
  })

  it("surfaces OAuth error descriptions", async () => {
    globalThis.fetch = vi.fn(async (): Promise<Response> => Response.json({
      error: "invalid_grant",
      error_description: "The refresh token is invalid.",
    }, { status: 400 }))

    await expect(refreshXAccessToken({
      clientId: "client",
      clientSecret: "secret",
      refreshToken: "refresh-token",
    })).rejects.toThrow("X authorization failed (400): The refresh token is invalid.")
  })
})
