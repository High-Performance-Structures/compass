type PurchaseOrderContactOption = {
  readonly contactType: string
}

type PurchaseOrderCostCodeOption = {
  readonly divisionCode: string
}

/** A typed amount or quantity ("1,250.00") as a number; blank or invalid is null. */
export function numberFromText(value: string): number | null {
  const trimmed = value.replaceAll(",", "").trim()
  if (trimmed.length === 0) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

export function textFromNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : ""
}

function normalizedDivisionCode(value: string): string | null {
  const match = /^\s*(\d{1,2})(?:\D|$)/.exec(value)
  if (match === null) return null

  return match[1].padStart(2, "0")
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

export function purchaseOrderSiteContactOptions<
  T extends PurchaseOrderContactOption,
>(options: readonly T[]): readonly T[] {
  return options.filter((option) => option.contactType === "internal")
}

export function purchaseOrderCostCodesForPhase<
  T extends PurchaseOrderCostCodeOption,
>(options: readonly T[], phaseCode: string): readonly T[] {
  const normalizedPhase = normalizedDivisionCode(phaseCode)
  if (normalizedPhase === null) return options

  const matchingOptions = options.filter(
    (option) => normalizedDivisionCode(option.divisionCode) === normalizedPhase
  )

  // Imported and manually typed phase values are not always canonical CSI
  // divisions. Keeping all codes visible is safer than presenting an empty menu.
  return matchingOptions.length > 0 ? matchingOptions : options
}
