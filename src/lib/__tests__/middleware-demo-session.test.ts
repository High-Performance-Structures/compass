import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const authkitMock = vi.hoisted(() => vi.fn())

vi.mock("@workos-inc/authkit-nextjs", () => ({
  authkit: authkitMock,
  handleAuthkitHeaders: (
    _request: NextRequest,
    _headers: Headers,
    options?: { readonly redirect?: string }
  ) =>
    options?.redirect
      ? new Response(null, { status: 307, headers: { location: options.redirect } })
      : new Response(null, { status: 200 }),
}))

vi.mock("@/lib/auth-config", () => ({
  isWorkOSConfigured: () => true,
  isDevAuthFallbackAllowed: () => false,
}))

import middleware from "@/middleware"

describe("middleware with WorkOS configured", () => {
  beforeEach(() => {
    authkitMock.mockResolvedValue({ session: { user: null }, headers: new Headers() })
  })

  it("sends a visitor with only the demo cookie to sign in", async () => {
    const request = new NextRequest("https://compass.example.test/dashboard", {
      headers: { cookie: "compass-demo=true" },
    })

    const response = await middleware(request)

    expect(response.status).toBe(307)
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/login")
  })
})
