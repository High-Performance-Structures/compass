import { describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  assertProjectAccess: vi.fn(),
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  hasActiveExternalProjectResourceGrant: vi.fn(),
  requireAuth: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/cloudflare-context", () => ({}))
vi.mock("@/lib/db", () => ({
  getCloudflareContext: mocks.getCloudflareContext,
}))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/project-access", () => ({
  assertProjectAccess: mocks.assertProjectAccess,
}))
vi.mock("@/lib/project-external-resource-access", () => ({
  hasActiveExternalProjectResourceGrant:
    mocks.hasActiveExternalProjectResourceGrant,
}))

import { NextRequest } from "next/server"
import { GET } from "@/app/api/projects/[id]/photos/[photoId]/route"

describe("project photo external access", () => {
  it("does not load a photo for an eligible owner without an explicit grant", async () => {
    const membershipQuery = {
      limit: vi.fn().mockResolvedValue([{ role: "owner" }]),
    }
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({ where: vi.fn(() => membershipQuery) })),
      })),
    }
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: {} } })
    mocks.getDb.mockReturnValue(db)
    mocks.requireAuth.mockResolvedValue({ id: "owner-1", role: "client" })
    mocks.assertProjectAccess.mockResolvedValue({ organizationId: "org-1" })
    mocks.hasActiveExternalProjectResourceGrant.mockResolvedValue(false)

    const response = await GET(
      new NextRequest(
        "https://compass.example/api/projects/project-1/photos/photo-1?audience=owner"
      ),
      { params: Promise.resolve({ id: "project-1", photoId: "photo-1" }) }
    )

    expect(response.status).toBe(404)
    expect(mocks.hasActiveExternalProjectResourceGrant).toHaveBeenCalledWith({
      db,
      organizationId: "org-1",
      projectId: "project-1",
      recipientUserId: "owner-1",
      resourceId: "photo-1",
      resourceType: "photo",
    })
  })
})
