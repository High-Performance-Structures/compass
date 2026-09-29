import { describe, expect, it } from "vitest"

import { formatPurchaseOrderMoney } from "@/lib/purchase-orders/money"

describe("purchase order money", () => {
  it("shows cents on unit costs, fractional line amounts, and totals", () => {
    expect(formatPurchaseOrderMoney(64)).toBe("$64.00")
    expect(formatPurchaseOrderMoney(0.082 * 64)).toBe("$5.25")
    expect(formatPurchaseOrderMoney(64 + 0.082 * 64)).toBe("$69.25")
  })

  it("keeps the missing amount label", () => {
    expect(formatPurchaseOrderMoney(null)).toBe("Amount TBD")
  })
})
