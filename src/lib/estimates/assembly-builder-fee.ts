import type { ClientEstimateLine, ClientEstimatePhase } from "@/lib/estimates/client-report"

function roundedRatio(numerator: bigint, denominator: bigint): number {
  if (denominator < 0n) return roundedRatio(-numerator, -denominator)
  const quotient = numerator / denominator
  const remainder = numerator % denominator
  return Number(quotient + (remainder * 2n >= denominator ? 1n : remainder * 2n < -denominator ? -1n : 0n))
}

/** Allocate the existing fee, never add a second fee or recalculate imported totals. */
export function assemblyBuilderFeeAllocation(input: {
  readonly groups: readonly ClientEstimatePhase[]
  readonly lines: readonly ClientEstimateLine[]
  readonly builderFeeCents: number
}): { readonly byGroup: ReadonlyMap<string, number>; readonly unallocatedCents: number } {
  const baseCents = input.lines.reduce((sum, line) => sum + (line.includeInBuilderFee ? line.lineTotalCents : 0), 0)
  const byGroup = new Map<string, number>()
  let cumulativeBaseCents = 0
  let allocatedCents = 0
  for (const group of input.groups) {
    cumulativeBaseCents += group.lines.reduce((sum, line) => sum + (line.includeInBuilderFee ? line.lineTotalCents : 0), 0)
    // Cumulative integer rounding reconciles to the saved fee, including credits.
    // Internal-only work retains its share in the project-level fee summary.
    const cumulativeFeeCents = baseCents === 0 ? 0 : roundedRatio(
      BigInt(input.builderFeeCents) * BigInt(cumulativeBaseCents), BigInt(baseCents)
    )
    byGroup.set(group.id, cumulativeFeeCents - allocatedCents)
    allocatedCents = cumulativeFeeCents
  }
  return { byGroup, unallocatedCents: input.builderFeeCents - allocatedCents }
}
