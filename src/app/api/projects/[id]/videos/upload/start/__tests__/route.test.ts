import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  assertActiveStaffOrganization: vi.fn(),
  requireFeaturePermission: vi.fn(),
  resolveProjectRouteId: vi.fn(),
  initiateProjectVideoWebsiteUpload: vi.fn(),
  json: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/project-access", () => ({
  assertActiveStaffOrganization: mocks.assertActiveStaffOrganization,
}))
vi.mock("@/lib/permission-enforcement", () => ({
  requireFeaturePermission: mocks.requireFeaturePermission,
}))
vi.mock("@/lib/project-route-id", () => ({
  resolveProjectRouteId: mocks.resolveProjectRouteId,
}))
vi.mock("@/lib/email/project-video-attachments", () => ({
  initiateProjectVideoWebsiteUpload: mocks.initiateProjectVideoWebsiteUpload,
}))
vi.mock("@/lib/org-scope", () => ({ requireOrg: vi.fn(() => "org-a") }))

import { POST } from "../route"

const user = {
  id: "staff-1",
  email: "staff@example.com",
  googleEmail: null,
  isActive: true,
  organizationId: "org-a",
  organizationType: "internal",
  role: "admin",
} as const

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAuth.mockResolvedValue(user)
  mocks.getCloudflareContext.mockResolvedValue({ env: { DB: "db" } })
  mocks.getDb.mockReturnValue({})
  mocks.assertActiveStaffOrganization.mockRejectedValue(
    new Error("Active internal organization is required")
  )
})

describe("POST /api/projects/:id/videos/upload/start", () => {
  it("denies a wrong authoritative organization before request parsing or provider setup", async () => {
    const request = { json: mocks.json } as unknown as Request
    const response = await POST(request, {
      params: Promise.resolve({ id: "project-a" }),
    })

    expect(response.status).toBe(403)
    expect(mocks.assertActiveStaffOrganization).toHaveBeenCalledWith(
      expect.anything(),
      user
    )
    expect(mocks.json).not.toHaveBeenCalled()
    expect(mocks.requireFeaturePermission).not.toHaveBeenCalled()
    expect(mocks.resolveProjectRouteId).not.toHaveBeenCalled()
    expect(mocks.initiateProjectVideoWebsiteUpload).not.toHaveBeenCalled()
  })
})
