/**
 * Keeping linked Compass vendors in step with Sage. Each time the Sage writer
 * sends Sage's vendor list, a vendor linked to a Sage record takes Sage's
 * name, owner, address, phone and email. Sage is where these are edited for a
 * linked vendor (Compass locks them, see contact-edit-gate), so Sage wins,
 * except that a blank in Sage leaves Compass's value alone: much of the
 * directory was imported with details Sage never had.
 *
 * The category follows Sage's vendor type through the company's mapping; a
 * vendor with no type in Sage keeps its Compass category. Pure: the caller
 * reads the rows and writes the plan.
 */

import type { SageVendorDirectoryDetails } from "@/lib/domain/sage-bridge/store"

type SageSyncedVendorField =
  | "name"
  | "category"
  | "ownerName"
  | "addressLine1"
  | "addressLine2"
  | "city"
  | "state"
  | "postalCode"
  | "phone"
  | "primaryEmail"

export type SageSyncedVendor = Readonly<Record<SageSyncedVendorField, string | null>> & {
  readonly id: string
  readonly address: string | null
}

export type SageVendorEntry = {
  readonly name: string
  readonly email: string | null
  readonly details: SageVendorDirectoryDetails
}

type SageVendorFieldChange = {
  readonly field: SageSyncedVendorField
  readonly before: string | null
  readonly after: string
}

export type SageVendorUpdate = {
  readonly vendorId: string
  readonly changes: readonly SageVendorFieldChange[]
  /** The columns to write, the free-text address included when a part of it changed. */
  readonly patch: Readonly<Partial<Record<SageSyncedVendorField | "address", string>>>
}

const ADDRESS_FIELDS = ["addressLine1", "addressLine2", "city", "state", "postalCode"] as const

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/**
 * The Compass category for a Sage vendor type: the company's mapping first,
 * then a Compass category of the same name. Null keeps Compass's category.
 */
export function compassCategoryForSageType(
  sageType: string | null,
  mapping: Readonly<Record<string, string>>,
  categories: readonly string[]
): string | null {
  const type = clean(sageType)?.toLowerCase()
  if (!type) return null
  for (const [name, category] of Object.entries(mapping)) {
    if (name.trim().toLowerCase() === type) return clean(category)
  }
  return categories.find((category) => category.trim().toLowerCase() === type) ?? null
}

/** "123 Main St, Suite 4, Denver, CO 80202" from the address parts. */
export function formatVendorAddress(parts: Readonly<Record<(typeof ADDRESS_FIELDS)[number], string | null>>): string | null {
  const region = [clean(parts.state), clean(parts.postalCode)].filter(Boolean).join(" ")
  const place = [clean(parts.city), region || null].filter(Boolean).join(", ")
  return [clean(parts.addressLine1), clean(parts.addressLine2), place || null].filter(Boolean).join(", ") || null
}

/** What changes on one linked vendor, or null when Compass already matches Sage. */
export function planSageVendorUpdate(
  vendor: SageSyncedVendor,
  entry: SageVendorEntry,
  categoryMapping: Readonly<Record<string, string>>,
  categories: readonly string[]
): SageVendorUpdate | null {
  const sage: Readonly<Record<SageSyncedVendorField, string | null>> = {
    name: clean(entry.name),
    category: compassCategoryForSageType(entry.details.vendorType, categoryMapping, categories),
    ownerName: clean(entry.details.ownerName),
    addressLine1: clean(entry.details.addressLine1),
    addressLine2: clean(entry.details.addressLine2),
    city: clean(entry.details.city),
    state: clean(entry.details.state),
    postalCode: clean(entry.details.postalCode),
    phone: clean(entry.details.phone),
    primaryEmail: clean(entry.email),
  }
  const changes: SageVendorFieldChange[] = []
  const patch: Partial<Record<SageSyncedVendorField | "address", string>> = {}
  for (const field of Object.keys(sage).filter(isSyncedField)) {
    const after = sage[field]
    const before = clean(vendor[field])
    if (after === null || after === before) continue
    changes.push({ field, before, after })
    patch[field] = after
  }
  if (changes.length === 0) return null
  if (changes.some((change) => isAddressField(change.field))) {
    const merged = Object.fromEntries(ADDRESS_FIELDS.map((field) => [field, patch[field] ?? vendor[field]]))
    const address = formatVendorAddress({
      addressLine1: merged.addressLine1 ?? null,
      addressLine2: merged.addressLine2 ?? null,
      city: merged.city ?? null,
      state: merged.state ?? null,
      postalCode: merged.postalCode ?? null,
    })
    if (address) patch.address = address
  }
  return { vendorId: vendor.id, changes, patch }
}

const SYNCED_FIELDS: ReadonlySet<string> = new Set<SageSyncedVendorField>([
  "name", "category", "ownerName", "addressLine1", "addressLine2", "city", "state", "postalCode", "phone", "primaryEmail",
])

function isSyncedField(field: string): field is SageSyncedVendorField {
  return SYNCED_FIELDS.has(field)
}

function isAddressField(field: SageSyncedVendorField): boolean {
  return ADDRESS_FIELDS.some((part) => part === field)
}

const FIELD_LABELS: Readonly<Record<SageSyncedVendorField, string>> = {
  name: "name",
  category: "category",
  ownerName: "owner",
  addressLine1: "address",
  addressLine2: "address line 2",
  city: "city",
  state: "state",
  postalCode: "ZIP",
  phone: "phone",
  primaryEmail: "email",
}

/** "Updated from Sage: name, owner, phone" for the vendor's Activity. */
export function sageVendorUpdateSummary(update: SageVendorUpdate): string {
  const labels = [...new Set(update.changes.map((change) => FIELD_LABELS[change.field]))]
  return `Updated from Sage: ${labels.join(", ")}`
}
