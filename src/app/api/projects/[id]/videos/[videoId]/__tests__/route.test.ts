import { describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  resolveProjectRouteId: vi.fn(),
  getActiveOrganization: vi.fn(),
  assertProjectAccess: vi.fn(),
  getProjectAudienceAccessRecord: vi.fn(),
  hasActiveExternalProjectResourceGrant: vi.fn(),
  downloadProjectVideoFile: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/project-route-id", () => ({
  resolveProjectRouteId: mocks.resolveProjectRouteId,
}))
vi.mock("@/lib/project-access", () => ({
  assertProjectAccess: mocks.assertProjectAccess,
  getActiveOrganization: mocks.getActiveOrganization,
  getProjectAudienceAccessRecord: mocks.getProjectAudienceAccessRecord,
}))
vi.mock("@/lib/project-external-resource-access", () => ({
  hasActiveExternalProjectResourceGrant:
    mocks.hasActiveExternalProjectResourceGrant,
}))
vi.mock("@/lib/email/project-video-attachments", () => ({
  downloadProjectVideoFile: mocks.downloadProjectVideoFile,
}))

describe("GET /api/projects/:id/videos/:videoId", () => {
  it("denies an external role when the authoritative organization is internal", async () => {
    mocks.requireAuth.mockResolvedValue({
      id: "external-user",
      role: "owner",
      isActive: true,
      organizationId: "org-internal",
    })
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: {} } })
    mocks.getDb.mockReturnValue({})
    mocks.resolveProjectRouteId.mockResolvedValue("project-a")
    mocks.getActiveOrganization.mockResolvedValue({
      id: "org-internal",
      type: "internal",
      isActive: true,
    })

    const { GET } = await import("../route")
    const response = await GET(
      new NextRequest("https://example.test/api/projects/project-a/videos/video-a"),
      {
        params: Promise.resolve({ id: "project-a", videoId: "video-a" }),
      }
    )

    expect(response.status).toBe(404)
    expect(mocks.assertProjectAccess).not.toHaveBeenCalled()
    expect(mocks.getProjectAudienceAccessRecord).not.toHaveBeenCalled()
    expect(mocks.downloadProjectVideoFile).not.toHaveBeenCalled()
  })

  it("denies an assigned external member without an exact resource grant", async () => {
    mocks.requireAuth.mockResolvedValue({
      id: "external-user",
      role: "owner",
      isActive: true,
      organizationId: "org-client",
    })
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: {} } })
    mocks.getDb.mockReturnValue({})
    mocks.resolveProjectRouteId.mockResolvedValue("project-a")
    mocks.getActiveOrganization.mockResolvedValue({
      id: "org-client",
      type: "client",
      isActive: true,
    })
    mocks.getProjectAudienceAccessRecord.mockResolvedValue({
      id: "project-a",
      organizationId: "org-client",
    })
    mocks.hasActiveExternalProjectResourceGrant.mockResolvedValue(false)

    const { GET } = await import("../route")
    const response = await GET(
      new NextRequest(
        "https://example.test/api/projects/project-a/videos/video-a?audience=owner"
      ),
      {
        params: Promise.resolve({ id: "project-a", videoId: "video-a" }),
      }
    )

    expect(response.status).toBe(404)
    expect(mocks.hasActiveExternalProjectResourceGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-client",
        projectId: "project-a",
        recipientUserId: "external-user",
        resourceId: "video-a",
        resourceType: "video",
      })
    )
    expect(mocks.downloadProjectVideoFile).not.toHaveBeenCalled()
  })
})
