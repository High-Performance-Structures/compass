/**
 * How an order line reads on the customer's estimate, after the Nu-Tech
 * cheat sheet ("30 bundles of 8" Core Straight"): the count, the product and
 * its SKU, and for blocks priced each but packed in bundles, the bundles.
 */
export function nuTechEstimateLineDescription(input: {
  readonly quantity: number
  readonly unit: string
  readonly name: string
  readonly sku: string
  /** Catalog package label: "12" (blocks per bundle), "230/box", "10/bag". */
  readonly packageLabel: string
}): string {
  const product = input.sku ? `${input.name} (${input.sku})` : input.name
  const unit = input.unit.trim().toLowerCase()
  if (unit === "each" || unit === "") {
    const perBundle = /^\d+$/.test(input.packageLabel.trim()) ? Number(input.packageLabel.trim()) : 0
    if (perBundle > 1 && input.quantity % perBundle === 0) {
      const bundles = input.quantity / perBundle
      return `${input.quantity} ${product}, ${bundles} bundle${bundles === 1 ? "" : "s"} of ${perBundle}`
    }
    return `${input.quantity} ${product}`
  }
  return `${input.quantity} ${pluralUnit(unit, input.quantity)} of ${product}`
}

function pluralUnit(unit: string, quantity: number): string {
  if (quantity === 1) return unit
  if (/(s|x|z|ch|sh)$/.test(unit)) return `${unit}es`
  return `${unit}s`
}
