import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  getDb: vi.fn(),
  isInternalStaffRole: vi.fn(),
  requireAuth: vi.fn(),
  requireFeaturePermission: vi.fn(),
  requireOrg: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/db", () => ({ getCloudflareContext: mocks.getCloudflareContext }))
vi.mock("@/db", () => ({ getDb: mocks.getDb }))
vi.mock("@/lib/demo", () => ({ isDemoUser: vi.fn(() => false) }))
vi.mock("@/lib/org-scope", () => ({ requireOrg: mocks.requireOrg }))
vi.mock("@/lib/permission-enforcement", () => ({
  requireFeaturePermission: mocks.requireFeaturePermission,
}))
vi.mock("@/lib/user-roles", () => ({
  isInternalStaffRole: mocks.isInternalStaffRole,
}))

import {
  getProjectPurchaseOrders,
  updatePurchaseOrderRequest,
  type UpdatePurchaseOrderRequestInput,
} from "@/app/actions/project-operations"

const UPDATE_INPUT: UpdatePurchaseOrderRequestInput = {
  title: "Updated purchase order",
  description: "Updated scope",
  companyName: "Vendor",
  sageVendorId: null,
  assigneeName: null,
  siteContactPhone: null,
  shipTo: null,
  orderDate: "2026-08-24",
  dueDate: null,
  priority: "normal",
  lines: [],
  expectedUpdatedAt: "2026-08-24T00:00:00.000Z",
}

describe("purchase-order action authorization boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isInternalStaffRole.mockImplementation(
      (role: string) => role !== "supplier"
    )
    mocks.requireFeaturePermission.mockResolvedValue(undefined)
  })

  it("denies an active external project member before purchase-order reads", async () => {
    mocks.requireAuth.mockResolvedValue({
      id: "supplier-1",
      role: "supplier",
      isActive: true,
    })

    await expect(getProjectPurchaseOrders("project-1")).rejects.toThrow(
      "Purchase orders are limited to active internal staff."
    )
    expect(mocks.requireFeaturePermission).not.toHaveBeenCalled()
    expect(mocks.requireOrg).not.toHaveBeenCalled()
    expect(mocks.getCloudflareContext).not.toHaveBeenCalled()
    expect(mocks.getDb).not.toHaveBeenCalled()
  })

  it("denies an inactive internal user before purchase-order reads", async () => {
    mocks.requireAuth.mockResolvedValue({
      id: "inactive-staff-1",
      role: "project_manager",
      isActive: false,
    })

    await expect(getProjectPurchaseOrders("project-1")).rejects.toThrow(
      "Purchase orders are limited to active internal staff."
    )
    expect(mocks.requireFeaturePermission).not.toHaveBeenCalled()
    expect(mocks.getCloudflareContext).not.toHaveBeenCalled()
    expect(mocks.getDb).not.toHaveBeenCalled()
  })

  it("denies an override-enabled external mutation before database work", async () => {
    mocks.requireAuth.mockResolvedValue({
      id: "supplier-1",
      role: "supplier",
      isActive: true,
    })

    const result = await updatePurchaseOrderRequest(
      "project-1",
      "purchase-order-1",
      UPDATE_INPUT
    )

    expect(result).toEqual({
      success: false,
      error: "Purchase orders are limited to active internal staff.",
    })
    expect(mocks.requireFeaturePermission).not.toHaveBeenCalled()
    expect(mocks.requireOrg).not.toHaveBeenCalled()
    expect(mocks.getCloudflareContext).not.toHaveBeenCalled()
    expect(mocks.getDb).not.toHaveBeenCalled()
  })
})
