/** An executed change order or variance shown on the pay application row it changed. */
export type LineChangeOrder = {
  readonly number: string
  readonly title: string
  readonly recordType: "change_order" | "variance"
  readonly amount: number
}

/** A pay application row's key: its cost code and assembly. */
export function lineChangeOrderKey(costCode: string, assemblyKey: string | null): string {
  return `${costCode}|${assemblyKey ?? ""}`
}

/**
 * How far a row is billed past its scheduled value, in dollars; zero when it
 * isn't. Compared in cents so rounding never flags a fully billed row.
 */
export function overBilledAmount(line: { readonly adjustedEstimate: number; readonly totalCompletedStored: number }): number {
  const overCents = Math.round(line.totalCompletedStored * 100) - Math.round(line.adjustedEstimate * 100)
  return overCents > 0 ? overCents / 100 : 0
}

/** The rows billed past their scheduled value. */
export function overBilledLines<T extends { readonly adjustedEstimate: number; readonly totalCompletedStored: number }>(
  lines: readonly T[]
): readonly T[] {
  return lines.filter((line) => overBilledAmount(line) > 0)
}

/** "CO-002 · Extra pump +$1,250.00": a row's change order label. */
export function lineChangeOrderLabel(change: LineChangeOrder, money: (value: number) => string): string {
  const name = [change.number, change.title].filter((part) => part.length > 0).join(" · ") || (change.recordType === "variance" ? "Variance" : "Change order")
  return `${name} ${change.amount < 0 ? "−" : "+"}${money(Math.abs(change.amount))}`
}
