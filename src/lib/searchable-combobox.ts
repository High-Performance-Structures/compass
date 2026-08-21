export function reconcileSearchableComboboxValue(
  options: readonly { readonly value: string }[],
  value: string
): string {
  if (value === "") return value
  return options.some((option) => option.value === value) ? value : ""
}
