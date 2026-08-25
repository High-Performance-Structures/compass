export type PurchaseOrderLineInput = {
  readonly description: string | null
  readonly costCode: string | null
  readonly phaseCode: string | null
  readonly quantity: number | null
  readonly unitCost: number | null
  readonly unit: string | null
  readonly amount: number | null
  readonly taxGroup: string | null
}

export type NormalizedPurchaseOrderLine = {
  readonly lineNumber: number
  readonly description: string
  readonly costCode: string | null
  readonly phaseCode: string | null
  readonly quantity: number
  readonly unitCost: number
  readonly unit: string | null
  readonly amount: number
  readonly taxGroup: string | null
}

type NormalizePurchaseOrderLinesOptions = {
  readonly allowEmpty?: boolean
}

function cleanText(value: string | null): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed.length > 0 ? trimmed : null
}

function numberOrDefault(value: number | null, fallback: number): number {
  return value === null || !Number.isFinite(value) ? fallback : value
}

export function normalizePurchaseOrderLines(
  lines: readonly PurchaseOrderLineInput[],
  fallbackDescription: string,
  options: NormalizePurchaseOrderLinesOptions = {},
): readonly NormalizedPurchaseOrderLine[] {
  const normalized = lines
    .map((line, index) => {
      const description = cleanText(line.description)
      const costCode = cleanText(line.costCode)
      const phaseCode = cleanText(line.phaseCode)
      const taxGroup = cleanText(line.taxGroup)
      const unit = cleanText(line.unit)
      const quantity = numberOrDefault(line.quantity, 1)
      const unitCost = numberOrDefault(line.unitCost, 0)
      const amount = numberOrDefault(line.amount, quantity * unitCost)
      const hasMeaningfulValue =
        description !== null ||
        costCode !== null ||
        phaseCode !== null ||
        taxGroup !== null ||
        unit !== null ||
        amount > 0 ||
        unitCost > 0

      if (!hasMeaningfulValue) return null

      return {
        lineNumber: index + 1,
        description: description ?? fallbackDescription,
        costCode,
        phaseCode,
        quantity,
        unitCost,
        unit,
        amount,
        taxGroup,
      }
    })
    .filter(
      (line): line is NormalizedPurchaseOrderLine => line !== null,
    )

  if (normalized.length > 0 || options.allowEmpty === true) return normalized

  return [
    {
      lineNumber: 1,
      description: fallbackDescription,
      costCode: null,
      phaseCode: null,
      quantity: 1,
      unitCost: 0,
      unit: null,
      amount: 0,
      taxGroup: null,
    },
  ]
}
