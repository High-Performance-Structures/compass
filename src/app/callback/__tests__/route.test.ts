import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const authMocks = vi.hoisted(() => ({
  handlePkceCallback: vi.fn(),
}))

vi.mock("@workos-inc/authkit-nextjs", () => ({
  handleAuth: () => authMocks.handlePkceCallback,
}))

vi.mock("@/lib/auth", () => ({
  ensureUserExists: vi.fn(),
}))

import { GET } from "../route"

describe("WorkOS callback", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMocks.handlePkceCallback.mockResolvedValue(
      NextResponse.redirect("https://compass.example/dashboard")
    )
  })

  it("routes a hosted password-reset callback back to explicit sign-in", async () => {
    const request = new NextRequest(
      "https://compass.example/callback?code=reset-code"
    )

    const response = await GET(request)

    expect(response.headers.get("location")).toBe(
      "https://compass.example/login?notice=password_reset_complete"
    )
    expect(authMocks.handlePkceCallback).not.toHaveBeenCalled()
  })

  it("keeps state-bearing sign-ins on the PKCE callback", async () => {
    const request = new NextRequest(
      "https://compass.example/callback?code=oauth-code&state=sealed-state"
    )

    await GET(request)

    expect(authMocks.handlePkceCallback).toHaveBeenCalledWith(request)
  })
})
