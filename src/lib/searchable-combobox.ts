export function reconcileSearchableComboboxValue(
  options: readonly { readonly value: string }[],
  value: string
): string {
  if (value === "") return value
  return options.some((option) => option.value === value) ? value : ""
}

/**
 * For a combobox that accepts new values: the typed text to offer as
 * "Add “…”", or null when it is blank or already matches an option's value
 * or label (compared trimmed and without case, so "kitchen" picks the
 * existing "Kitchen" instead of adding a near-duplicate).
 */
export function creatableComboboxText(
  options: readonly { readonly value: string; readonly label: string }[],
  search: string
): string | null {
  const text = search.trim()
  const key = text.toLocaleLowerCase()
  if (!key) return null
  const exists = options.some(
    (option) =>
      option.value.trim().toLocaleLowerCase() === key ||
      option.label.trim().toLocaleLowerCase() === key
  )
  return exists ? null : text
}
