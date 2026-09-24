/**
 * Sage-linked identity values must not be changed in Compass before the
 * reviewed contact-write path has returned a verified Sage read-back.
 * Local-only directory metadata remains editable.
 */
const CUSTOMER_IDENTITY_FIELDS = [
  "name", "company", "email", "phone", "address", "addressLine1",
  "addressLine2", "city", "state", "postalCode", "billingAddressLine1",
  "billingAddressLine2", "billingCity", "billingState",
  "billingPostalCode", "primaryEmail",
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

/** Preserve the pre-existing guarded blank-email Sage queue, and only it. */
export function isLegacySageClientEmailFill(
  existing: Readonly<Record<string, unknown>>,
  patch: Readonly<Record<string, unknown>>
): boolean {
  return normalized(existing.sageClientId) !== null &&
    normalized(existing.sageClientNumber) !== null &&
    normalized(existing.email) === null &&
    Object.prototype.hasOwnProperty.call(patch, "email") &&
    normalized(patch.email) !== null &&
    !changesSageLinkedCustomerIdentity(existing, { ...patch, email: existing.email })
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
}

/** The full-form vendor dialog resubmits unchanged child contacts. */
export function sameSageLinkedVendorContacts(
  submitted: readonly VendorContactInput[],
  existing: readonly ExistingVendorContact[]
): boolean {
  const active = existing.filter((contact) => contact.active)
  if (submitted.length !== active.length) return false
  const byId = new Map(active.map((contact) => [contact.id, contact]))
  return submitted.every((contact) => {
    const row = contact.id ? byId.get(contact.id) : null
    return row !== null && row !== undefined &&
      row.name.trim() === contact.name &&
      (row.title?.trim() ?? "") === contact.title &&
      (row.email?.trim().toLowerCase() ?? "") === contact.email &&
      (row.phone?.trim() ?? "") === contact.phone &&
      row.isPrimary === contact.isPrimary
  })
}
