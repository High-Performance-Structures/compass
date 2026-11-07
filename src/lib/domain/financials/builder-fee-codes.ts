import { CONTRACT_ADJUSTMENT_COST_CODES } from "@/lib/financials/project-totals-import"

/**
 * Builder fee lines (overhead, margin, contingency) reach Compass under two
 * cost-code identities: the Sage catalog name ("Company Overhead"), which the
 * estimate and contract budget use, and the legacy Division 99 code
 * ("99 10 00"), which imported draws and change-order fee adjustments carry.
 * The Sage name is canonical: it is what the Sage handoff resolves by.
 */
function normalized(value: string): string {
  return value.trim().replaceAll(/\s+/g, " ").toLowerCase()
}

const FEE_NAME_BY_ALIAS: ReadonlyMap<string, string> = new Map(
  CONTRACT_ADJUSTMENT_COST_CODES.flatMap((fee) => [
    [normalized(fee.value), fee.description],
    [normalized(fee.description), fee.description],
  ])
)

/** The fee's canonical name when `costCode` is a builder fee code, else null. */
function builderFeeName(costCode: string): string | null {
  return FEE_NAME_BY_ALIAS.get(normalized(costCode)) ?? null
}

/**
 * One identity per builder fee: "99 10 00" and "Company Overhead" both become
 * "Company Overhead". Any other cost code comes back unchanged.
 */
export function canonicalFeeCostCode(costCode: string): string {
  return builderFeeName(costCode) ?? costCode
}

/**
 * The cost code a change-order line belongs under in the contract budget. A
 * builder fee, coded either way, takes the code of the budget's own fee line
 * (which may be a Sage code), so its change merges into that line. Other cost
 * codes are unchanged.
 */
export function budgetFeeCostCode(
  budgetLines: readonly { readonly costCode: string; readonly description: string }[],
  costCode: string
): string {
  const fee = builderFeeName(costCode)
  if (!fee) return costCode
  // By code first; then by name, for a fee line filed under a Sage code (fee
  // lines come after the estimate's own lines).
  const feeLine =
    budgetLines.find((line) => builderFeeName(line.costCode) === fee) ??
    budgetLines.findLast((line) => builderFeeName(line.description) === fee)
  return feeLine?.costCode ?? fee
}

/**
 * Whether rows that share one canonical cost code were filed under more than
 * one spelling of it (say "99 10 00" and "Company Overhead"). Such rows can't
 * be matched row by row and are spread by scheduled value instead.
 */
export function mixesFeeCostCodes(costCodes: readonly string[]): boolean {
  return new Set(costCodes).size > 1
}
