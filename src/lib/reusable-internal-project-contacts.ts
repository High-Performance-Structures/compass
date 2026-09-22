type InternalProjectContact = {
  readonly id: string
  readonly projectId: string
  readonly displayName: string
  readonly email: string | null
  readonly phone: string | null
}

function contactKey(contact: InternalProjectContact): string {
  const email = contact.email?.trim().toLowerCase()
  if (email) return `email:${email}`
  const phone = contact.phone?.replace(/\D/g, "")
  if (phone) return `name-phone:${contact.displayName.trim().toLowerCase()}:${phone}`
  return `record:${contact.id}`
}

/** Rows arrive newest first; reuse one current contact per identity. */
export function reusableInternalProjectContacts<T extends InternalProjectContact>(
  rows: readonly T[],
  projectId: string
): readonly T[] {
  const existingKeys = new Set(
    rows.filter((row) => row.projectId === projectId).map(contactKey)
  )
  const seenKeys = new Set<string>()
  const reusable: T[] = []
  for (const row of rows) {
    if (row.projectId === projectId) continue
    const key = contactKey(row)
    if (existingKeys.has(key) || seenKeys.has(key)) continue
    seenKeys.add(key)
    reusable.push(row)
  }
  return reusable
}
