export type DraftPurchaseOrderLine = {
  readonly id: string
  readonly description: string
  readonly phaseCode: string
  readonly costCode: string
  readonly quantity: string
  readonly unitCost: string
  readonly unit: string
  readonly amount: string
  readonly taxGroup: string
}

export type PurchaseOrderDraftLineSource = {
  readonly id: string
  readonly description: string
  readonly phaseCode: string | null
  readonly costCode: string | null
  readonly quantity: number
  readonly unitCost: number
  readonly unit: string | null
  readonly amount: number
  readonly taxGroup: string | null
}

type PurchaseOrderDraftSource = {
  readonly lines: readonly PurchaseOrderDraftLineSource[]
}

function textFromNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : ""
}

export function draftLinesFromPurchaseOrder(
  purchaseOrder: PurchaseOrderDraftSource | null,
  createFallbackLine: () => DraftPurchaseOrderLine,
): readonly DraftPurchaseOrderLine[] {
  if (purchaseOrder === null) return [createFallbackLine()]

  return purchaseOrder.lines.map((line) => ({
    id: line.id,
    description: line.description,
    phaseCode: line.phaseCode ?? "",
    costCode: line.costCode ?? "",
    quantity: textFromNumber(line.quantity),
    unitCost: textFromNumber(line.unitCost),
    unit: line.unit ?? "",
    amount:
      line.amount === line.quantity * line.unitCost
        ? ""
        : textFromNumber(line.amount),
    taxGroup: line.taxGroup ?? "",
  }))
}
