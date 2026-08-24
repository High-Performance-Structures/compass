import type { NuTechCustomerType, NuTechPricingMode } from "@/lib/nutech/workflow"

export function nuTechCustomerPriceCents(
  prices: {
    readonly newStandardPriceCents: number
    readonly newCashPriceCents: number
    readonly returningStandardPriceCents: number
    readonly returningCashPriceCents: number
  },
  customerType: NuTechCustomerType,
  pricingMode: NuTechPricingMode
): number {
  if (customerType === "new") {
    return pricingMode === "cash_discount"
      ? prices.newCashPriceCents
      : prices.newStandardPriceCents
  }
  return pricingMode === "cash_discount"
    ? prices.returningCashPriceCents
    : prices.returningStandardPriceCents
}

export function validateNuTechOrderQuantity(input: {
  readonly manufacturerSku: string
  readonly quantity: number
  readonly minimumOrderIncrement: number
}): void {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new Error(`${input.manufacturerSku} quantity must be a positive whole number.`)
  }
  if (input.quantity % input.minimumOrderIncrement !== 0) {
    throw new Error(
      `${input.manufacturerSku} quantity must be a multiple of ${input.minimumOrderIncrement}.`
    )
  }
}
