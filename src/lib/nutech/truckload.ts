/**
 * How much of a full manufacturer truckload an order takes, the way the old
 * Truckload Calculator sheet figured it: each product's bundles over the
 * bundles of that product that fill a truck, summed. Pure, so the rules are
 * tested without a database.
 */

export type NuTechTruckloadItem = {
  readonly manufacturerSku: string
  readonly category: string
  readonly quantity: number
  /** "each" when the quantity is in pieces; otherwise it is already in packages. */
  readonly priceUnit: string
  /** Pieces per bundle. */
  readonly packageQuantity: number
  /** Bundles of this product that fill a truck; null when not set on the price list. */
  readonly bundlesPerTruckload: number | null
}

type NuTechTruckloadLine = {
  readonly manufacturerSku: string
  readonly bundles: number
  readonly bundlesPerTruckload: number
}

export type NuTechTruckload = {
  /** 1 is one full truck. */
  readonly fraction: number
  readonly lines: readonly NuTechTruckloadLine[]
  /** Blocks on the order whose truckload size isn't set, so they aren't counted. */
  readonly missingSkus: readonly string[]
}

/** Bundles an order line ships in; a part bundle counts as a whole one. */
export function nuTechOrderBundles(item: Pick<NuTechTruckloadItem, "quantity" | "priceUnit" | "packageQuantity">): number {
  if (item.priceUnit !== "each") return item.quantity
  return Math.ceil(item.quantity / Math.max(1, item.packageQuantity))
}

/** Null when nothing on the order has a truckload size. */
export function nuTechTruckload(items: readonly NuTechTruckloadItem[]): NuTechTruckload | null {
  const lines: NuTechTruckloadLine[] = []
  const missingSkus: string[] = []
  for (const item of items) {
    if (item.quantity <= 0) continue
    if (item.bundlesPerTruckload && item.bundlesPerTruckload > 0) {
      lines.push({
        manufacturerSku: item.manufacturerSku,
        bundles: nuTechOrderBundles(item),
        bundlesPerTruckload: item.bundlesPerTruckload,
      })
    } else if (item.category === "block") {
      missingSkus.push(item.manufacturerSku)
    }
  }
  if (lines.length === 0) return null
  const fraction = lines.reduce((total, line) => total + line.bundles / line.bundlesPerTruckload, 0)
  return { fraction, lines, missingSkus }
}

/** "About 81% of a full truckload", or "About 1.4 truckloads" past one truck. */
export function nuTechTruckloadLabel(fraction: number): string {
  if (fraction <= 1) return `About ${Math.max(1, Math.round(fraction * 100))}% of a full truckload`
  return `About ${(Math.round(fraction * 10) / 10).toFixed(1)} truckloads`
}
