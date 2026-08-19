type FieldTaskUserIdentity = {
  readonly email: string
  readonly displayName: string | null
  readonly firstName: string | null
  readonly lastName: string | null
}

function normalizedIdentity(value: string | null): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9@._+-]+/g, " ")
    .trim()
}

export function isTaskAssignedToFieldUser(
  assigneeName: string | null,
  user: FieldTaskUserIdentity
): boolean {
  const assignee = normalizedIdentity(assigneeName)
  if (!assignee) return false

  const fullName = [user.firstName, user.lastName]
    .map((part) => normalizedIdentity(part))
    .filter(Boolean)
    .join(" ")
  const aliases = [
    normalizedIdentity(user.email),
    normalizedIdentity(user.displayName),
    fullName,
  ].filter(Boolean)

  return aliases.some((alias) => alias === assignee)
}
