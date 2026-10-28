/**
 * Where each priced line of an approved bid goes on the estimate: into an
 * existing line for the same cost code that is still waiting at $0, or onto a
 * new line when the estimate has none. Each waiting line takes one bid line;
 * lines priced by "Priced by" are preferred, then estimate order.
 */
export type BidFillTarget = {
  readonly id: string
  readonly costCode: string
  readonly lineTotalCents: number
  readonly pricingSource: string | null
  readonly sortOrder: number
  /** Lines priced from a cost breakdown are never overwritten. */
  readonly hasCostItems: boolean
}

export type BidFillPlan<T> =
  | { readonly kind: "fill"; readonly bidLine: T; readonly targetLineId: string }
  | { readonly kind: "add"; readonly bidLine: T }

export function planBidFill<T extends { readonly costCode: string | null }>(
  bidLines: readonly T[],
  estimateLines: readonly BidFillTarget[],
): readonly BidFillPlan<T>[] {
  const waiting = estimateLines
    .filter((line) => line.lineTotalCents === 0 && !line.hasCostItems)
    .sort((a, b) => Number(b.pricingSource !== null) - Number(a.pricingSource !== null) || a.sortOrder - b.sortOrder)
  const used = new Set<string>()
  return bidLines.map((bidLine) => {
    const target = bidLine.costCode
      ? waiting.find((line) => !used.has(line.id) && line.costCode === bidLine.costCode)
      : undefined
    if (!target) return { kind: "add", bidLine }
    used.add(target.id)
    return { kind: "fill", bidLine, targetLineId: target.id }
  })
}
