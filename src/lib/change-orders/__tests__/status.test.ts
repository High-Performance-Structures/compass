import { describe, expect, it } from "vitest"

import {
  changeOrderDisplayStatus,
  changeOrderStatusLabel,
} from "@/lib/change-orders/status"

describe("change-order status labels", () => {
  it("keeps the source approval meaning without naming the source (the [BT] tag does)", () => {
    expect(changeOrderDisplayStatus("executed", "buildertrend_import")).toBe("Approved")
    expect(changeOrderDisplayStatus("draft", "buildertrend_import")).toBe("Draft")
  })

  it("uses the Compass workflow label for native records", () => {
    expect(changeOrderDisplayStatus("executed", "internal_request")).toBe(
      changeOrderStatusLabel("executed")
    )
  })
})
