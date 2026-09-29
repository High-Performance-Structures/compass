import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  requireFeaturePermission: vi.fn(),
  assertProjectAccess: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/permission-enforcement", () => ({
  requireFeaturePermission: mocks.requireFeaturePermission,
}))
vi.mock("@/lib/project-access", () => ({
  assertProjectAccess: mocks.assertProjectAccess,
}))
vi.mock("@/lib/demo", () => ({ isDemoUser: vi.fn(() => false) }))
vi.mock("@/lib/email/project-video-attachments", () => ({
  downloadProjectVideoFile: vi.fn(),
}))
vi.mock("@/lib/google/youtube", () => ({
  getYoutubeOAuthConfig: vi.fn(),
  refreshYoutubeAccessToken: vi.fn(),
  uploadVideoToYoutube: vi.fn(),
  youtubeChannelKey: vi.fn(),
  youtubeTokenSalt: vi.fn(),
}))

import { getProjectPhotoLibrary } from "@/app/actions/project-photos"
import { getProjectVideoWorkspace } from "@/app/actions/project-videos"

const baseUser = {
  id: "external-1",
  email: "external@example.com",
  firstName: null,
  lastName: null,
  displayName: null,
  avatarUrl: null,
  dashboardDeskPhotoUrl: null,
  sidebarDeskPhotoUrl: null,
  role: "client",
  googleEmail: null,
  isActive: true,
  lastLoginAt: null,
  organizationId: "org-a",
  organizationName: "Org A",
  organizationType: "client",
  createdAt: "2026-09-01",
  updatedAt: "2026-09-01",
} as const

describe("project media Server Action boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    ["external", baseUser],
    ["inactive staff", { ...baseUser, role: "admin", organizationType: "internal", isActive: false }],
  ])("denies %s before permission, organization, or DB work", async (_label, user) => {
    mocks.requireAuth.mockResolvedValue(user)

    await expect(getProjectPhotoLibrary("project-a")).rejects.toThrow(
      "Project photo access requires active internal staff"
    )
    await expect(getProjectVideoWorkspace("project-a")).rejects.toThrow(
      "Project video access requires active internal staff"
    )

    expect(mocks.requireAuth).toHaveBeenCalledTimes(3)
    expect(mocks.requireFeaturePermission).not.toHaveBeenCalled()
    expect(mocks.getCloudflareContext).not.toHaveBeenCalled()
    expect(mocks.getDb).not.toHaveBeenCalled()
    expect(mocks.assertProjectAccess).not.toHaveBeenCalled()
  })
})
