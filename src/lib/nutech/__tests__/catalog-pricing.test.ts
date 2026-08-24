import { describe, expect, it } from "vitest"

import {
  nuTechCustomerPriceCents,
  validateNuTechOrderQuantity,
} from "@/lib/nutech/catalog-pricing"

const prices = {
  newStandardPriceCents: 2640,
  newCashPriceCents: 2560,
  returningStandardPriceCents: 2560,
  returningCashPriceCents: 2480,
}

describe("Nu-Tech catalog pricing", () => {
  it("selects the published tier without calling standard pricing credit-card pricing", () => {
    expect(nuTechCustomerPriceCents(prices, "new", "standard")).toBe(2640)
    expect(nuTechCustomerPriceCents(prices, "new", "cash_discount")).toBe(2560)
    expect(nuTechCustomerPriceCents(prices, "returning", "standard")).toBe(2560)
    expect(nuTechCustomerPriceCents(prices, "returning", "cash_discount")).toBe(2480)
  })

  it("enforces manufacturer package increments", () => {
    expect(() =>
      validateNuTechOrderQuantity({
        manufacturerSku: "FOX-S600A",
        quantity: 13,
        minimumOrderIncrement: 12,
      })
    ).toThrow("multiple of 12")
  })
})
