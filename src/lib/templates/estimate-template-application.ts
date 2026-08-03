import {
  calculateEstimateLine,
  calculateEstimateTotals,
  type EstimateLedgerTotals,
} from "@/lib/financials/estimate-ledger"

export type EstimateTemplateSourceLine = {
  readonly id: string
  readonly divisionCode: string
  readonly divisionName: string
  readonly costCode: string
  readonly costCodeName: string
  readonly description: string
  readonly specifications: string | null
  readonly quantity: number
  readonly unit: string
  readonly unitCostCents: number
  readonly markupRateBasisPoints: number
  readonly taxable: boolean
  readonly taxCode: string | null
  readonly ownerVisible: boolean
  readonly sortOrder: number
}

export type EstimateTemplateTaxEntity = {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly rateBasisPoints: number
}

export type AppliedEstimateTemplateLine = EstimateTemplateSourceLine & {
  readonly templateLineId: string
  readonly taxEntityId: string | null
  readonly taxName: string | null
  readonly taxRateBasisPoints: number
  readonly directCostCents: number
  readonly markupCents: number
  readonly taxCents: number
  readonly lineTotalCents: number
}

export type EstimateTemplateApplication = {
  readonly lines: readonly AppliedEstimateTemplateLine[]
  readonly totals: EstimateLedgerTotals
}

export type EstimateTemplateApplicationResult =
  | { readonly success: true; readonly data: EstimateTemplateApplication }
  | { readonly success: false; readonly error: string }

function validNonNegativeNumber(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}

export function buildEstimateTemplateApplication(input: {
  readonly lines: readonly EstimateTemplateSourceLine[]
  readonly taxEntities: readonly EstimateTemplateTaxEntity[]
  readonly defaultTaxEntityId: string | null
}): EstimateTemplateApplicationResult {
  if (input.lines.length === 0) {
    return { success: false, error: "The estimate template has no lines." }
  }

  const defaultTax = input.defaultTaxEntityId
    ? input.taxEntities.find(
        (entity) => entity.id === input.defaultTaxEntityId
      ) ?? null
    : null
  const applied: AppliedEstimateTemplateLine[] = []

  for (const source of input.lines) {
    if (!source.costCode.trim() || !source.description.trim()) {
      return {
        success: false,
        error: "Every estimate template line needs a cost code and description.",
      }
    }
    if (
      !validNonNegativeNumber(source.quantity) ||
      !validNonNegativeNumber(source.unitCostCents) ||
      !validNonNegativeNumber(source.markupRateBasisPoints)
    ) {
      return {
        success: false,
        error: `Template line ${source.costCode} has invalid quantity, cost, or markup.`,
      }
    }

    const selectedTax = source.taxable
      ? source.taxCode
        ? input.taxEntities.find((entity) => entity.code === source.taxCode) ??
          null
        : defaultTax
      : null
    if (source.taxable && !selectedTax) {
      return {
        success: false,
        error: `Template line ${source.costCode} is taxable but no matching Sage tax entity is available.`,
      }
    }

    const calculation = calculateEstimateLine({
      quantity: source.quantity,
      unitCostCents: source.unitCostCents,
      markupRateBasisPoints: source.markupRateBasisPoints,
      taxable: source.taxable,
      taxRateBasisPoints: selectedTax?.rateBasisPoints ?? 0,
    })
    applied.push({
      ...source,
      templateLineId: source.id,
      taxEntityId: selectedTax?.id ?? null,
      taxCode: selectedTax?.code ?? null,
      taxName: selectedTax?.name ?? null,
      taxRateBasisPoints: selectedTax?.rateBasisPoints ?? 0,
      ...calculation,
    })
  }

  return {
    success: true,
    data: {
      lines: applied,
      totals: calculateEstimateTotals(
        applied.map((line) => ({
          id: line.id,
          divisionCode: line.divisionCode,
          divisionName: line.divisionName,
          costCode: line.costCode,
          description: line.description,
          directCostCents: line.directCostCents,
          markupCents: line.markupCents,
          taxCents: line.taxCents,
          lineTotalCents: line.lineTotalCents,
          ownerVisible: line.ownerVisible,
          sortOrder: line.sortOrder,
        }))
      ),
    },
  }
}
