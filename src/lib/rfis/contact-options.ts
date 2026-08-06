export type RfiContactGroup =
  | "internal"
  | "owner"
  | "subcontractor"
  | "supplier"

export type RfiContactOption = {
  readonly value: string
  readonly label: string
  readonly group: RfiContactGroup
}

type RfiContactCandidate = {
  readonly label: string
  readonly contactType: string
}

export const RFI_CONTACT_GROUPS: readonly {
  readonly value: RfiContactGroup
  readonly label: string
}[] = [
  { value: "internal", label: "Internal staff" },
  { value: "owner", label: "Owners" },
  { value: "subcontractor", label: "Subcontractors" },
  { value: "supplier", label: "Suppliers" },
]

function rfiContactGroup(value: string): RfiContactGroup {
  if (value === "owner") return "owner"
  if (value === "subcontractor") return "subcontractor"
  if (value === "supplier") return "supplier"
  return "internal"
}

export function buildRfiContactOptions(
  candidates: readonly RfiContactCandidate[]
): readonly RfiContactOption[] {
  const options = new Map<string, RfiContactOption>()

  for (const candidate of candidates) {
    const label = candidate.label.trim()
    if (!label) continue
    const key = label.toLocaleLowerCase()
    if (options.has(key)) continue
    options.set(key, {
      value: label,
      label,
      group: rfiContactGroup(candidate.contactType),
    })
  }

  const groupOrder = new Map(
    RFI_CONTACT_GROUPS.map((group, index) => [group.value, index])
  )
  return Array.from(options.values()).sort((first, second) => {
    const groupDifference =
      (groupOrder.get(first.group) ?? 0) -
      (groupOrder.get(second.group) ?? 0)
    return groupDifference || first.label.localeCompare(second.label)
  })
}
