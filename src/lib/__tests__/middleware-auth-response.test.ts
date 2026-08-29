import { describe, expect, it } from "vitest"
import { NextRequest } from "next/server"

import {
  unauthenticatedApiResponse,
  unauthenticatedPageUrl,
} from "@/middleware"

describe("middleware API authentication response", () => {
  it("returns JSON 401 while forwarding only safe AuthKit response headers", async () => {
    const request = new NextRequest(
      "https://compass.example/api/field/native-bootstrap"
    )
    const response = unauthenticatedApiResponse(
      request,
      new Headers({
        "cache-control": "no-store",
        "set-cookie": "wos-session=; Path=/; Max-Age=0",
        "x-workos-session": "must-not-reach-the-client",
      })
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      success: false,
      error: "Authentication required.",
    })
    expect(response.headers.get("set-cookie")).toContain("wos-session=")
    expect(response.headers.get("x-workos-session")).toBeNull()
  })

  it("preserves the native platform on the login redirect", () => {
    const request = new NextRequest(
      "https://compass.example/dashboard/projects?nativePlatform=ios"
    )

    const loginUrl = unauthenticatedPageUrl(request)

    expect(loginUrl.pathname).toBe("/login")
    expect(loginUrl.searchParams.get("from")).toBe("/dashboard/projects")
    expect(loginUrl.searchParams.get("nativePlatform")).toBe("ios")
  })

  it("does not trust an unknown native-platform hint", () => {
    const request = new NextRequest(
      "https://compass.example/dashboard?nativePlatform=desktop"
    )

    const loginUrl = unauthenticatedPageUrl(request, "auth_unavailable")

    expect(loginUrl.searchParams.get("error")).toBe("auth_unavailable")
    expect(loginUrl.searchParams.has("nativePlatform")).toBe(false)
  })
})
