import { describe, expect, it } from "vitest"

import { buildPurchaseOrderUpdateInput } from "@/lib/purchase-orders/update-input"

describe("purchase-order edit request input", () => {
  it("uses the loaded revision as the stale-write compare token", () => {
    const request = {
      title: "Updated draft",
      description: null,
      companyName: "Vendor",
      sageVendorId: null,
      assigneeName: null,
      siteContactPhone: null,
      shipTo: null,
      orderDate: "2026-08-25",
      dueDate: null,
      priority: "normal",
      lines: [],
    } as const

    const result = buildPurchaseOrderUpdateInput(request, { revision: 7 })

    expect(result).toEqual({ ...request, expectedRevision: 7 })
    expect(result).not.toHaveProperty("expectedUpdatedAt")
  })
})