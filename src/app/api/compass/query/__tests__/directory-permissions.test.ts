import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  canFeature: vi.fn(),
  customerFindMany: vi.fn(),
  customerFindFirst: vi.fn(),
  vendorFindMany: vi.fn(),
  vendorFindFirst: vi.fn(),
  row: vi.fn(),
}))

vi.mock("@/lib/db", () => ({ getCloudflareContext: async () => ({ env: { DB: {} } }) }))
vi.mock("@/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          innerJoin: () => ({ where: () => ({ get: mocks.row }) }),
        }),
      }),
    }),
    query: {
      customers: { findMany: mocks.customerFindMany, findFirst: mocks.customerFindFirst },
      vendors: { findMany: mocks.vendorFindMany, findFirst: mocks.vendorFindFirst },
    },
  }),
}))
vi.mock("@/lib/agent/api-auth", () => ({
  validateAgentAuth: async () => ({ valid: true, userId: "user-1", orgId: "org-1", role: "office", isDemoUser: false }),
}))
vi.mock("@/lib/permission-enforcement", () => ({ canFeature: mocks.canFeature }))

import { POST } from "../route"

const activeRow = {
  user: {
    id: "user-1", email: "staff@example.com", firstName: "Staff", lastName: "User",
    displayName: "Staff User", phone: null, address: null, avatarUrl: null,
    dashboardDeskPhotoUrl: null, sidebarDeskPhotoUrl: null, role: "office",
    googleEmail: null, isActive: true, lastLoginAt: null, createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  },
  membershipRole: "office",
  organization: { id: "org-1", name: "HPS", type: "internal", isActive: true },
}

describe("Compass query directory permission boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.row.mockResolvedValue(activeRow)
    mocks.canFeature.mockResolvedValue(false)
  })

  for (const queryType of ["customers", "customer_detail", "vendors", "vendor_detail"]) {
    it(`denies ${queryType} when the staff directory grant is none`, async () => {
      const response = await POST(new Request("https://compass.example/api/compass/query", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer test" },
        body: JSON.stringify({ queryType, id: "record-1" }),
      }))
      expect(response.status).toBe(403)
      expect(mocks.canFeature).toHaveBeenCalledWith(
        expect.objectContaining({ id: "user-1", organizationId: "org-1", role: "office" }),
        queryType.startsWith("customer") ? "customers" : "vendors",
        "read"
      )
      expect(mocks.customerFindMany).not.toHaveBeenCalled()
      expect(mocks.customerFindFirst).not.toHaveBeenCalled()
      expect(mocks.vendorFindMany).not.toHaveBeenCalled()
      expect(mocks.vendorFindFirst).not.toHaveBeenCalled()
    })
  }

  it("rejects a stale token role before checking a directory grant", async () => {
    mocks.row.mockResolvedValue({ ...activeRow, membershipRole: "client" })
    const response = await POST(new Request("https://compass.example/api/compass/query", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ queryType: "customers" }),
    }))
    expect(response.status).toBe(403)
    expect(mocks.canFeature).not.toHaveBeenCalled()
  })
})
