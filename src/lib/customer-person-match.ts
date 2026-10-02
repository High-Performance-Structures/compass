export function findExistingNamedPerson<Person extends { readonly id: string; readonly name: string }>(
  people: readonly Person[],
  name: string,
  excludingId: string | null = null
): Person | null {
  const normalizedName = name.trim().toLocaleLowerCase()
  if (!normalizedName) return null
  return people.find((person) =>
    person.id !== excludingId && person.name.trim().toLocaleLowerCase() === normalizedName
  ) ?? null
}
