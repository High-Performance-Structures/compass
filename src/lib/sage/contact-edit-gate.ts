/**
 * Sage-linked identity values must not be changed in Compass before the
 * reviewed contact-write path has returned a verified Sage read-back.
 * Local-only directory metadata remains editable.
 */
// Client "company" is not here: Sage has no such column (its client name is
// "name"), so it is a Compass-only directory field. Neither is client primary
// email: its Sage binding is unverified, nothing from Sage writes it, so it is
// Compass's own until that binding is proven.
const CUSTOMER_IDENTITY_FIELDS = [
  "name", "email", "phone", "address", "addressLine1",
  "addressLine2", "city", "state", "postalCode", "billingAddressLine1",
  "billingAddressLine2", "billingCity", "billingState",
  "billingPostalCode",
] as const

const VENDOR_IDENTITY_FIELDS = [
  "name", "email", "phone", "address", "ownerName", "addressLine1",
  "addressLine2", "city", "state", "postalCode", "primaryEmail",
] as const

function normalized(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function hasChangedIdentityField(
  existing: Readonly<Record<string, unknown>>,
  patch: Readonly<Record<string, unknown>>,
  fields: readonly string[]
): boolean {
  return fields.some(
    (field) =>
      Object.prototype.hasOwnProperty.call(patch, field) &&
      normalized(existing[field]) !== normalized(patch[field])
  )
}

export function changesSageLinkedCustomerIdentity(
  existing: Readonly<Record<string, unknown>>,
  patch: Readonly<Record<string, unknown>>
): boolean {
  return hasChangedIdentityField(existing, patch, CUSTOMER_IDENTITY_FIELDS)
}

export function changesSageLinkedVendorIdentity(
  existing: Readonly<Record<string, unknown>>,
  patch: Readonly<Record<string, unknown>>
): boolean {
  return hasChangedIdentityField(existing, patch, VENDOR_IDENTITY_FIELDS)
}

type VendorContactInput = {
  readonly id: string | null
  readonly name: string
  readonly title: string
  readonly email: string
  readonly phone: string
  readonly isPrimary: boolean
}

type ExistingVendorContact = {
  readonly id: string
  readonly name: string
  readonly title: string | null
  readonly email: string | null
  readonly phone: string | null
  readonly isPrimary: boolean
  readonly active: boolean
  readonly sageContactId: string | null
  readonly sageLineNumber: number | null
}

/** A person Sage knows: it carries a Sage contact id or line number. */
export function isSageLinkedPerson(person: { readonly sageContactId: string | null; readonly sageLineNumber: number | null }): boolean {
  return Boolean(person.sageContactId?.trim()) || person.sageLineNumber !== null
}

/**
 * Why a people edit on a Sage-linked vendor cannot be saved in Compass, or
 * null when it can. Sage people are identity: each must be resubmitted
 * unchanged. Compass-only people (no Sage ids) may be added, edited or
 * removed locally (owner decision 2026-11-02), but never become primary,
 * since primary belongs to the people Sage manages.
 */
export function sageLinkedVendorPeopleChangeError(
  submitted: readonly VendorContactInput[],
  existing: readonly ExistingVendorContact[]
): string | null {
  const active = existing.filter((contact) => contact.active)
  const byId = new Map(active.map((contact) => [contact.id, contact]))
  const submittedById = new Map(submitted.flatMap((contact) => (contact.id ? [[contact.id, contact] as const] : [])))
  for (const contact of submitted) {
    const row = contact.id ? byId.get(contact.id) : undefined
    if (contact.id && !row) return "Vendor contact not found"
    if (row && isSageLinkedPerson(row)) continue
    // A Compass-only person keeps the primary flag it already had, and never gains it.
    if (contact.isPrimary && !row?.isPrimary) return COMPASS_ONLY_PRIMARY_ERROR
  }
  for (const row of active.filter(isSageLinkedPerson)) {
    const contact = submittedById.get(row.id)
    const unchanged = contact !== undefined &&
      row.name.trim() === contact.name &&
      (row.title?.trim() ?? "") === contact.title &&
      (row.email?.trim().toLowerCase() ?? "") === contact.email &&
      (row.phone?.trim() ?? "") === contact.phone &&
      row.isPrimary === contact.isPrimary
    if (!unchanged) return SAGE_PEOPLE_ERROR
  }
  return null
}

const SAGE_PEOPLE_ERROR = "This vendor is linked to Sage. Contact changes need Sage review before Compass can update the directory."
export const COMPASS_ONLY_PRIMARY_ERROR = "A Compass-only person cannot be the primary contact of a Sage-linked vendor."
