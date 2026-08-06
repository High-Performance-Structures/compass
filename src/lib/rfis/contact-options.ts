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
  candidates: readonly RfiContactCandidate[],
  projectOwnerName?: string | null
): readonly RfiContactOption[] {
  const options = new Map<string, RfiContactOption>()

  function addCandidate(candidate: RfiContactCandidate): void {
    const label = candidate.label.trim()
    if (!label) return
    const key = label.toLocaleLowerCase()
    if (options.has(key)) return
    options.set(key, {
      value: label,
      label,
      group: rfiContactGroup(candidate.contactType),
    })
  }

  for (const candidate of candidates) addCandidate(candidate)

  // Imported projects can have an owner on the project record before their
  // project-contact rows are reconciled. Keep that owner reachable from RFIs.
  addCandidate({ label: projectOwnerName ?? "", contactType: "owner" })

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
