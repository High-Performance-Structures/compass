export type ProjectContactIdentity = {
  readonly email: string | null
  readonly phone: string | null
  readonly address: string | null
}

export type ProjectContactDirectoryIdentityReference = {
  readonly sourceEntityType: string
  readonly sourceEntityId: string | null
  readonly vendorContactId: string | null
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
 * Linked directory records own contact identity. Project contacts retain a
 * snapshot so imports and offline reads continue to work when a directory
 * field is empty or temporarily unavailable.
 */
export function resolveProjectContactIdentity(
  projectIdentity: ProjectContactIdentity,
  directoryIdentity: ProjectContactIdentity | null
): ProjectContactIdentity {
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
 * Active Compass users own their identity fields. Editing their project
 * metadata must therefore ignore identity values echoed by the contact form.
 * Existing snapshots remain a fallback when the directory profile is blank.
 */
export function resolveProjectContactMutationIdentity(input: {
  readonly submittedIdentity: ProjectContactIdentity
  readonly existingIdentity: ProjectContactIdentity | null
  readonly directoryIdentity: ProjectContactIdentity | null
  readonly managedByActiveUser: boolean
}): ProjectContactIdentity {
  if (!input.managedByActiveUser) return input.submittedIdentity

  return resolveProjectContactIdentity(
    input.existingIdentity ?? EMPTY_PROJECT_CONTACT_IDENTITY,
    input.directoryIdentity
  )
}

/** Vendor-person migrations retain the vendor as the source entity. */
export function isSameProjectContactDirectoryIdentity(
  existing: ProjectContactDirectoryIdentityReference,
  next: ProjectContactDirectoryIdentityReference
): boolean {
  if (next.vendorContactId) {
    return existing.vendorContactId === next.vendorContactId
  }

  return (
    existing.vendorContactId === null &&
    existing.sourceEntityType === next.sourceEntityType &&
    existing.sourceEntityId === next.sourceEntityId
  )
}
