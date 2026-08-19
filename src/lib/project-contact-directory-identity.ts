export type ProjectContactIdentity = {
  readonly email: string | null
  readonly phone: string | null
  readonly address: string | null
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
