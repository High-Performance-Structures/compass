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

/** The canonical builder fee names, which new work files fees under. */
export const BUILDER_FEE_NAMES: readonly string[] = CONTRACT_ADJUSTMENT_COST_CODES.map(
  (fee) => fee.description
)

/** The retired Division 99 fee codes, for matching stored rows. */
export const LEGACY_FEE_COST_CODES: readonly string[] = CONTRACT_ADJUSTMENT_COST_CODES.map(
  (fee) => fee.value
)

/** Whether `costCode` names a builder fee, by either spelling. */
export function isBuilderFeeCostCode(costCode: string): boolean {
  return builderFeeName(costCode) !== null
}

const LEGACY_FEE_CODE_SET: ReadonlySet<string> = new Set(
  LEGACY_FEE_COST_CODES.map(normalized)
)

/**
 * Whether `costCode` is a retired Division 99 fee code ("99 10 00" etc.). They
 * are read as aliases of the canonical fee names but never offered for new work.
 */
export function isLegacyFeeCostCode(costCode: string): boolean {
  return LEGACY_FEE_CODE_SET.has(normalized(costCode))
}

/** Where new work files each builder fee when the catalog has no row for it. */
const BUILDER_FEE_FALLBACK_DIVISION = {
  divisionCode: "00",
  divisionDescription: "Procurement Requirements",
} as const

type FeeCatalogRow = {
  readonly code: string
  readonly description: string
  readonly divisionCode: string
  readonly divisionDescription: string
}

/**
 * The catalog row new work files a builder fee under, for either spelling of
 * the fee: the row named for it (a Sage code such as "34" when Sage has one),
 * else the fee name under Division 00. Null when `costCode` isn't a fee.
 */
export function builderFeeCatalogRow<Row extends FeeCatalogRow>(
  catalog: readonly Row[],
  costCode: string
): Row | FeeCatalogRow | null {
  const fee = builderFeeName(costCode)
  if (!fee) return null
  return (
    catalog.find((row) => row.code === costCode && !isLegacyFeeCostCode(row.code)) ??
    catalog.find((row) => normalized(row.description) === normalized(fee) && !isLegacyFeeCostCode(row.code)) ??
    { code: fee, description: fee, ...BUILDER_FEE_FALLBACK_DIVISION }
  )
}

/**
 * Resolves a source cost code against the catalog for a new record. A legacy
 * Division 99 fee code resolves to its canonical fee row, so importers that
 * read old sheets never create new 99-coded lines.
 */
export function resolveCatalogCostCode<Row extends FeeCatalogRow>(
  catalogByCode: ReadonlyMap<string, Row>,
  costCode: string
): Row | FeeCatalogRow | null {
  if (!isLegacyFeeCostCode(costCode)) return catalogByCode.get(costCode) ?? null
  return builderFeeCatalogRow([...catalogByCode.values()], costCode)
}

/**
 * The fee choices a cost-code picker should add: one per builder fee the
 * catalog has no row for, keyed by the canonical fee name.
 */
export function missingBuilderFeeRows(
  catalog: readonly FeeCatalogRow[]
): readonly FeeCatalogRow[] {
  const named = new Set(catalog.map((row) => normalized(row.description)))
  return CONTRACT_ADJUSTMENT_COST_CODES.filter(
    (fee) => !named.has(normalized(fee.description))
  ).map((fee) => ({
    code: fee.description,
    description: fee.description,
    ...BUILDER_FEE_FALLBACK_DIVISION,
  }))
}
