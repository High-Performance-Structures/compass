/**
 * Supplier POs drawn against an accepted quote: what's been ordered, and
 * what's still left to order on each accepted cost code.
 */

type TradeOrderLine = {
  readonly costCode: string | null
  readonly amountCents: number
}

export type TradeOrder = {
  readonly status: string
  readonly lines: readonly TradeOrderLine[]
}

export type TradeCode = {
  readonly costCode: string | null
  readonly description: string
  readonly amountCents: number
}

/** A void PO no longer orders anything. */
export function countsAgainstAcceptedPrice(status: string): boolean {
  return status.trim().toLowerCase() !== "void"
}

export function orderedCents(orders: readonly TradeOrder[]): number {
  return orders
    .filter((order) => countsAgainstAcceptedPrice(order.status))
    .reduce((sum, order) => sum + order.lines.reduce((lineSum, line) => lineSum + line.amountCents, 0), 0)
}

/**
 * Each accepted code less what's already on POs for that code. Lines coded
 * to anything else (freight, a code the quote didn't have) come off nothing,
 * so they never hide what's left on the accepted codes.
 */
export function remainingTradeCodes(codes: readonly TradeCode[], orders: readonly TradeOrder[]): readonly TradeCode[] {
  const ordered = new Map<string, number>()
  for (const order of orders) {
    if (!countsAgainstAcceptedPrice(order.status)) continue
    for (const line of order.lines) {
      const key = line.costCode ?? ""
      ordered.set(key, (ordered.get(key) ?? 0) + line.amountCents)
    }
  }
  const remaining: TradeCode[] = []
  for (const code of codes) {
    const key = code.costCode ?? ""
    const used = Math.min(ordered.get(key) ?? 0, code.amountCents)
    ordered.set(key, (ordered.get(key) ?? 0) - used)
    const left = code.amountCents - used
    if (left > 0) remaining.push({ ...code, amountCents: left })
  }
  return remaining
}
