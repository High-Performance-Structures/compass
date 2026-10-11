import { describe, expect, it } from "vitest"

import { airlitePurchaseOrderNumber } from "@/lib/nutech/airlite-po-number"

describe("airlitePurchaseOrderNumber", () => {
  it("joins the project number and the PO sequence", () => {
    expect(airlitePurchaseOrderNumber("N-0-0", 1860)).toBe("N-0-0-1860")
    expect(airlitePurchaseOrderNumber(null, 1860)).toBe("1860")
  })
})
