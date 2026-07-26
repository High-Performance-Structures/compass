import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AuthUser } from "@/lib/auth"

const authMocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  getCurrentUser: authMocks.getCurrentUser,
}))

import { POST as postAgent } from "@/app/api/agent/route"
import { POST as postAgentAction } from "@/app/api/agent/action/route"
import { POST as postAgentRender } from "@/app/api/agent/render/route"

const guest: AuthUser = {
  id: "guest-user",
  email: "guest@example.com",
  firstName: null,
  lastName: null,
  displayName: "Guest",
  avatarUrl: null,
  role: "guest",
  googleEmail: null,
  isActive: true,
  lastLoginAt: null,
  organizationId: "org-1",
  organizationName: "Example",
  organizationType: "external",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
}

function requestFor(path: string): Request {
  return new Request(`https://compass.example${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  })
}

describe("guest Ask Compass API access", () => {
  beforeEach(() => {
    authMocks.getCurrentUser.mockResolvedValue(guest)
  })

  it.each([
    ["/api/agent", postAgent],
    ["/api/agent/action", postAgentAction],
    ["/api/agent/render", postAgentRender],
  ])("returns 403 from %s", async (path, handler) => {
    const response = await handler(requestFor(path))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: "Ask Compass is not available for this account",
    })
  })
})
