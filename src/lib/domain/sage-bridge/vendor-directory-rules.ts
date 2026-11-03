/**
 * Pure rules for linking Compass vendors to Sage's vendor records in bulk.
 * Only exact, one-to-one matches are offered: the same company name (case,
 * punctuation and a legal suffix aside) or the same email, with no second
 * candidate on either side. Everything else is left for a person.
 */

export type CompassVendorForLink = {
  readonly id: string
  readonly name: string
  readonly emails: readonly (string | null)[]
  /** Already linked to this Sage record id, if any. */
  readonly sageRecordId: string | null
}

export type SageVendorEntry = {
  readonly sageRecordId: string
  readonly sageVendorNumber: string
  readonly name: string
  readonly email: string | null
}

export type SageVendorMatch = {
  readonly vendorId: string
  readonly vendorName: string
  readonly sageRecordId: string
  readonly sageVendorNumber: string
  readonly sageName: string
  readonly by: "name" | "email"
}

const LEGAL_SUFFIX = /\b(incorporated|inc|llc|l l c|ltd|limited|co|corp|corporation|company|pllc|lp|llp)\b/g

/** A company name reduced for comparison: "Acme Concrete, Inc." → "acme concrete". */
export function normalizeVendorName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(LEGAL_SUFFIX, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeEmail(email: string | null): string | null {
  const value = email?.trim().toLowerCase() ?? ""
  return value.includes("@") ? value : null
}

function groupBy<T>(items: readonly T[], keysOf: (item: T) => readonly string[]): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    for (const key of new Set(keysOf(item))) {
      if (key.length === 0) continue
      const list = groups.get(key) ?? []
      list.push(item)
      groups.set(key, list)
    }
  }
  return groups
}

/** One-to-one exact matches between unlinked Compass vendors and unclaimed Sage vendors. */
export function matchSageVendors(vendors: readonly CompassVendorForLink[], entries: readonly SageVendorEntry[]): readonly SageVendorMatch[] {
  const claimed = new Set(vendors.map((vendor) => vendor.sageRecordId?.toLowerCase()).filter((id): id is string => Boolean(id)))
  const open = vendors.filter((vendor) => !vendor.sageRecordId)
  const free = entries.filter((entry) => !claimed.has(entry.sageRecordId.toLowerCase()))

  const vendorsByName = groupBy(open, (vendor) => [normalizeVendorName(vendor.name)])
  const entriesByName = groupBy(free, (entry) => [normalizeVendorName(entry.name)])
  const vendorsByEmail = groupBy(open, (vendor) => vendor.emails.map(normalizeEmail).filter((email): email is string => email !== null))
  const entriesByEmail = groupBy(free, (entry) => [normalizeEmail(entry.email) ?? ""])

  const matches: SageVendorMatch[] = []
  const usedVendors = new Set<string>()
  const usedEntries = new Set<string>()
  const take = (vendor: CompassVendorForLink, entry: SageVendorEntry, by: SageVendorMatch["by"]): void => {
    if (usedVendors.has(vendor.id) || usedEntries.has(entry.sageRecordId)) return
    usedVendors.add(vendor.id)
    usedEntries.add(entry.sageRecordId)
    matches.push({ vendorId: vendor.id, vendorName: vendor.name, sageRecordId: entry.sageRecordId, sageVendorNumber: entry.sageVendorNumber, sageName: entry.name, by })
  }

  for (const [name, list] of vendorsByName) {
    const sage = entriesByName.get(name)
    if (list.length === 1 && sage?.length === 1) take(list[0], sage[0], "name")
  }
  for (const [email, list] of vendorsByEmail) {
    const sage = entriesByEmail.get(email)
    if (list.length === 1 && sage?.length === 1) take(list[0], sage[0], "email")
  }
  return matches.sort((left, right) => left.vendorName.localeCompare(right.vendorName))
}
