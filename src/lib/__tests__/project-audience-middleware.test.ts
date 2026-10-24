import { describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { AUDIENCE_SCOPE_HEADER, parseAudienceScope } from "@/lib/project-audience-request"
vi.mock("@/lib/auth-config", () => ({ isWorkOSConfigured: () => false, isDevAuthFallbackAllowed: () => true }))
import middleware from "@/middleware"

describe("preview scope middleware", () => {
  it("overwrites a forged effective identity with the URL's actual preview scope", async () => {
    const response = await middleware(new NextRequest("https://example.test/preview/projects/project-a/owner?previewAs=owner-a", { headers: { [AUDIENCE_SCOPE_HEADER]: JSON.stringify({ projectId: "secret", audience: "owner", targetUserId: "admin" }) } }))
    expect(parseAudienceScope(response.headers.get(`x-middleware-request-${AUDIENCE_SCOPE_HEADER}`))).toEqual({ projectId: "project-a", audience: "owner", targetUserId: "owner-a" })
  })
  it("strips forged scope from ordinary staff requests", async () => {
    const response = await middleware(new NextRequest("https://example.test/dashboard", { headers: { [AUDIENCE_SCOPE_HEADER]: "forged" } }))
    expect(response.headers.get(`x-middleware-request-${AUDIENCE_SCOPE_HEADER}`)).toBeNull()
  })
  it("rejects mutation APIs explicitly carrying preview scope", async () => {
    const response = await middleware(new NextRequest("https://example.test/api/correspondence/attachments?previewProject=project-a&previewAudience=owner&previewAs=owner-a", { method: "POST" }))
    expect(response.status).toBe(403)
  })
})
