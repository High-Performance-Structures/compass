/** Project contacts must never expose or retain an employee's private address. */
export function projectContactAddress(
  contactType: string,
  address: string | null
): string | null {
  return contactType === "internal" ? null : address
}
