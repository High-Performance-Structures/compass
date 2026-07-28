type PurchaseOrderContactOption = {
  readonly contactType: string
}

type PurchaseOrderCostCodeOption = {
  readonly divisionCode: string
}

export function purchaseOrderVendorOptions<
  T extends PurchaseOrderContactOption,
>(options: readonly T[]): readonly T[] {
  return options.filter(
    (option) =>
      option.contactType === "supplier" ||
      option.contactType === "subcontractor"
  )
}

export function purchaseOrderInternalOwnerOptions<
  T extends PurchaseOrderContactOption,
>(options: readonly T[]): readonly T[] {
  return options.filter((option) => option.contactType === "internal")
}

export function purchaseOrderCostCodesForPhase<
  T extends PurchaseOrderCostCodeOption,
>(options: readonly T[], phaseCode: string): readonly T[] {
  const normalizedPhase = phaseCode.trim()
  if (normalizedPhase.length === 0) return options

  return options.filter(
    (option) => option.divisionCode.trim() === normalizedPhase
  )
}
