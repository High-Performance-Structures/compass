type PurchaseOrderSiteContactOption = {
  readonly phone: string | null
}

export type PurchaseOrderSiteContactSelection = {
  readonly name: string
  readonly phone: string
}

export function purchaseOrderSiteContactSelection(input: {
  readonly name: string
  readonly currentName: string
  readonly currentPhone: string
  readonly option: PurchaseOrderSiteContactOption | null
}): PurchaseOrderSiteContactSelection {
  if (input.name.trim().length === 0) {
    return { name: "", phone: "" }
  }

  return {
    name: input.name,
    phone:
      input.option !== null
        ? input.option.phone ?? ""
        : input.name.trim().toLowerCase() ===
            input.currentName.trim().toLowerCase()
          ? input.currentPhone
          : "",
  }
}

export function purchaseOrderSiteContactLabel(input: {
  readonly name: string | null
  readonly phone: string | null
}): string {
  const values = [input.name, input.phone]
    .map((value) => value?.trim() ?? "")
    .filter((value) => value.length > 0)

  return values.length > 0 ? values.join(" · ") : "TBD"
}
