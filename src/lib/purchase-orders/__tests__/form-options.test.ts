import { describe, expect, it } from "vitest"

import {
  purchaseOrderCostCodesForPhase,
  purchaseOrderSiteContactOptions,
  purchaseOrderVendorOptions,
} from "@/lib/purchase-orders/form-options"

describe("purchase order form options", () => {
  const contacts = [
    { id: "supplier", contactType: "supplier" },
    { id: "subcontractor", contactType: "subcontractor" },
    { id: "internal", contactType: "internal" },
    { id: "owner", contactType: "owner" },
  ]

  it("keeps suppliers and subcontractors in the vendor selector", () => {
    expect(purchaseOrderVendorOptions(contacts).map((option) => option.id)).toEqual([
      "supplier",
      "subcontractor",
    ])
  })

  it("keeps only staff choices in the site contact selector", () => {
    expect(
      purchaseOrderSiteContactOptions(contacts).map((option) => option.id)
    ).toEqual(["internal"])
  })

  it("filters cost codes to the selected phase while keeping all codes before selection", () => {
    const costCodes = [
      { value: "03-100", divisionCode: "03" },
      { value: "06-100", divisionCode: "06" },
      { value: "06-200", divisionCode: "06" },
    ]

    expect(purchaseOrderCostCodesForPhase(costCodes, "")).toHaveLength(3)
    expect(
      purchaseOrderCostCodesForPhase(costCodes, "06").map(
        (option) => option.value
      )
    ).toEqual(["06-100", "06-200"])
  })
})
