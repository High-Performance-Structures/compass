import { describe, expect, it } from "vitest"

import { normalizePurchaseOrderLines } from "../line-items"

describe("normalizePurchaseOrderLines", () => {
  it("keeps an edited purchase order empty when its final line is removed", () => {
    expect(
      normalizePurchaseOrderLines([], "Purchase order scope", true),
    ).toEqual([])
  })

  it("keeps a create request with no lines valid through its fallback line", () => {
    expect(normalizePurchaseOrderLines([], "Purchase order scope")).toEqual([
      {
        lineNumber: 1,
        description: "Purchase order scope",
        costCode: null,
        phaseCode: null,
        quantity: 1,
        unitCost: 0,
        unit: null,
        amount: 0,
        taxGroup: null,
      },
    ])
  })
})
