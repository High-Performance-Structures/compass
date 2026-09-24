export type ProjectContactIdentity = {
  readonly email: string | null
  readonly phone: string | null
  readonly address: string | null
}

export type ProjectContactDirectoryIdentityReference = {
  readonly sourceEntityType: string
  readonly sourceEntityId: string | null
  readonly customerContactId: string | null
  readonly vendorContactId: string | null
}

export function isCanonicalDirectoryAssignment(input: {
  readonly sourceEntityType: string
  readonly customerId: string | null
  readonly customerContactId: string | null
  readonly vendorId: string | null
  readonly vendorContactId: string | null
  readonly internalContactId: string | null
}): boolean {
  return input.customerId !== null ||
    input.customerContactId !== null ||
    input.vendorId !== null ||
    input.vendorContactId !== null ||
    input.internalContactId !== null ||
    ["customer", "customer_contact", "vendor", "vendor_contact", "internal_contact", "user"].includes(input.sourceEntityType)
}

const EMPTY_PROJECT_CONTACT_IDENTITY: ProjectContactIdentity = {
  email: null,
  phone: null,
  address: null,
}

function preferredValue(
  directoryValue: string | null,
  projectValue: string | null
): string | null {
  const normalizedDirectoryValue = directoryValue?.trim() ?? ""
  if (normalizedDirectoryValue) return normalizedDirectoryValue

  const normalizedProjectValue = projectValue?.trim() ?? ""
  return normalizedProjectValue || null
}

/**
 * A confirmed directory link owns every current identity field, including
 * intentional blanks. Unlinked legacy rows retain their project snapshots.
 */
export function resolveProjectContactIdentity(
  projectIdentity: ProjectContactIdentity,
  directoryIdentity: ProjectContactIdentity | null,
  canonicalLink = false
): ProjectContactIdentity {
  if (canonicalLink) {
    return {
      email: preferredValue(directoryIdentity?.email ?? null, null),
      phone: preferredValue(directoryIdentity?.phone ?? null, null),
      address: preferredValue(directoryIdentity?.address ?? null, null),
    }
  }
  if (!directoryIdentity) {
    return {
      email: preferredValue(null, projectIdentity.email),
      phone: preferredValue(null, projectIdentity.phone),
      address: preferredValue(null, projectIdentity.address),
    }
  }

  return {
    email: preferredValue(directoryIdentity.email, projectIdentity.email),
    phone: preferredValue(directoryIdentity.phone, projectIdentity.phone),
    address: preferredValue(directoryIdentity.address, projectIdentity.address),
  }
}

/**
 * Shared directory records own identity fields. Editing project assignment
 * metadata must ignore identity values echoed by the project form. Existing
 * snapshots only remain a fallback when the directory is unavailable.
 */
export function resolveProjectContactMutationIdentity(input: {
  readonly submittedIdentity: ProjectContactIdentity
  readonly existingIdentity: ProjectContactIdentity | null
  readonly directoryIdentity: ProjectContactIdentity | null
  readonly managedByDirectory: boolean
}): ProjectContactIdentity {
  if (!input.managedByDirectory) return input.submittedIdentity

  return resolveProjectContactIdentity(
    input.existingIdentity ?? EMPTY_PROJECT_CONTACT_IDENTITY,
    input.directoryIdentity,
    input.directoryIdentity !== null
  )
}

/** Vendor-person migrations retain the vendor as the source entity. */
export function isSameProjectContactDirectoryIdentity(
  existing: ProjectContactDirectoryIdentityReference,
  next: ProjectContactDirectoryIdentityReference
): boolean {
  if (next.customerContactId) {
    return existing.customerContactId === next.customerContactId
  }
  if (next.vendorContactId) {
    return existing.vendorContactId === next.vendorContactId
  }

  return (
    existing.customerContactId === null &&
    existing.vendorContactId === null &&
    existing.sourceEntityType === next.sourceEntityType &&
    existing.sourceEntityId === next.sourceEntityId
  )
}
