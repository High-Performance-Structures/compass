/** Distinct, sorted assignee names from the project's task assignee options. */
export function warrantyAssigneeNames(options: {
  readonly projectContacts: readonly { readonly name: string }[]
  readonly directoryContacts: readonly { readonly name: string }[]
}): readonly string[] {
  return Array.from(
    new Set(
      [...options.projectContacts, ...options.directoryContacts]
        .map((option) => option.name.trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right))
}

/**
 * Picker choices that always include the claim's current assignee, so a name
 * missing from the list (an older contact, or a page that loaded no list)
 * still shows, and saving never clears the assignment by accident.
 */
export function warrantyAssigneeChoices(
  names: readonly string[],
  current: string | null,
): readonly string[] {
  const trimmed = current?.trim()
  return trimmed && !names.includes(trimmed) ? [trimmed, ...names] : names
}
