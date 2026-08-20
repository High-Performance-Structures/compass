import { describe, expect, it } from "vitest"

import {
  purchaseOrderSiteContactLabel,
  purchaseOrderSiteContactSelection,
} from "@/lib/purchase-orders/site-contact"

describe("purchase order site contact", () => {
  it("copies an internal contact phone when that contact is selected", () => {
    expect(
      purchaseOrderSiteContactSelection({
        name: "Casey Foreman",
        currentName: "",
        currentPhone: "",
        option: { phone: "719.555.0134" },
      })
    ).toEqual({ name: "Casey Foreman", phone: "719.555.0134" })
  })

  it("preserves a manually entered phone for an external contact", () => {
    expect(
      purchaseOrderSiteContactSelection({
        name: "Alex Driver",
        currentName: "Alex Driver",
        currentPhone: "303.555.0198",
        option: null,
      })
    ).toEqual({ name: "Alex Driver", phone: "303.555.0198" })
  })

  it("clears an auto-filled phone when switching to a typed external contact", () => {
    expect(
      purchaseOrderSiteContactSelection({
        name: "Alex Driver",
        currentName: "Casey Foreman",
        currentPhone: "719.555.0134",
        option: null,
      })
    ).toEqual({ name: "Alex Driver", phone: "" })
  })

  it("clears the phone when the contact is cleared", () => {
    expect(
      purchaseOrderSiteContactSelection({
        name: "",
        currentName: "Casey Foreman",
        currentPhone: "303.555.0198",
        option: null,
      })
    ).toEqual({ name: "", phone: "" })
  })

  it("formats available contact details without empty separators", () => {
    expect(
      purchaseOrderSiteContactLabel({
        name: "Casey Foreman",
        phone: "719.555.0134",
      })
    ).toBe("Casey Foreman · 719.555.0134")
    expect(purchaseOrderSiteContactLabel({ name: null, phone: null })).toBe(
      "TBD"
    )
  })
})
