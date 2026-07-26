import { describe, expect, it } from "vitest"

import { dashboardNavigation } from "@/lib/dashboard/navigation"

describe("dashboardNavigation", () => {
  it("routes Open POs to the purchase-order workflow", () => {
    expect(dashboardNavigation.openPurchaseOrders).toBe(
      "/dashboard/purchase-orders"
    )
    expect(dashboardNavigation.openPurchaseOrders).not.toContain("financials")
  })
})
