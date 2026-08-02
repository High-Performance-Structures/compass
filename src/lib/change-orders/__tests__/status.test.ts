import { describe, expect, it } from "vitest"

import {
  changeOrderDisplayStatus,
  changeOrderStatusLabel,
} from "@/lib/change-orders/status"

describe("change-order status labels", () => {
  it("preserves the Buildertrend approval meaning for imported records", () => {
    expect(changeOrderDisplayStatus("executed", "buildertrend_import")).toBe(
      "Approved · Buildertrend"
    )
    expect(changeOrderDisplayStatus("draft", "buildertrend_import")).toBe(
      "Draft · Buildertrend"
    )
  })

  it("uses the Compass workflow label for native records", () => {
    expect(changeOrderDisplayStatus("executed", "internal_request")).toBe(
      changeOrderStatusLabel("executed")
    )
  })
})
