import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  getActiveOrganization: vi.fn(),
  assertProjectAccess: vi.fn(),
  getProjectAudienceStaff: vi.fn(),
  getProjectAudienceViewerContact: vi.fn(),
  notifyRfiCreated: vi.fn(),
  resolveSubVendorRfiRecipient: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/project-access", () => ({
  assertProjectAccess: mocks.assertProjectAccess,
  getActiveOrganization: mocks.getActiveOrganization,
}))
vi.mock("@/lib/notifications/events", () => ({
  notifyPurchaseOrderVendorUpdate: vi.fn(),
  notifyRfiCreated: mocks.notifyRfiCreated,
  notifyRfqResponseReceived: vi.fn(),
}))
vi.mock("@/lib/project-audience-staff", () => ({
  getProjectAudienceStaff: mocks.getProjectAudienceStaff,
}))
vi.mock("@/lib/project-audience-viewer-contact", () => ({
  getProjectAudienceViewerContact: mocks.getProjectAudienceViewerContact,
}))
vi.mock("@/lib/rfis/sub-vendor-recipient", () => ({
  resolveSubVendorRfiRecipient: mocks.resolveSubVendorRfiRecipient,
}))

import { createSubVendorRfi } from "@/app/actions/project-audience-sub-vendor"

const staleInternalAuth = {
  id: "stale-internal-auth",
  email: "vendor@example.com",
  firstName: null,
  lastName: null,
  displayName: "Vendor User",
  avatarUrl: null,
  dashboardDeskPhotoUrl: null,
  sidebarDeskPhotoUrl: null,
  role: "subcontractor",
  googleEmail: null,
  isActive: true,
  lastLoginAt: null,
  organizationId: "demo-org",
  organizationName: "Demo",
  organizationType: "internal",
  createdAt: "2026-09-01",
  updatedAt: "2026-09-01",
} as const

describe("sub/vendor mutation authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("rejects every mutator context for an authoritative demo organization", async () => {
    mocks.requireAuth.mockResolvedValue(staleInternalAuth)
    mocks.getCloudflareContext.mockResolvedValue({ env: { DB: "db" } })
    mocks.getDb.mockReturnValue({})
    mocks.getActiveOrganization.mockResolvedValue({ id: "demo-org", type: "demo" })

    await expect(
      createSubVendorRfi("project-a", {
        subject: "Need clarification",
        question: "Please confirm the material detail.",
        priority: "normal",
        recipientUserId: null,
      })
    ).resolves.toEqual({ success: false, error: "Demo mode is read-only" })

    expect(mocks.getActiveOrganization).toHaveBeenCalledWith({}, staleInternalAuth)
    expect(mocks.assertProjectAccess).not.toHaveBeenCalled()
    expect(mocks.getProjectAudienceViewerContact).not.toHaveBeenCalled()
    expect(mocks.getProjectAudienceStaff).not.toHaveBeenCalled()
    expect(mocks.notifyRfiCreated).not.toHaveBeenCalled()
  })
})