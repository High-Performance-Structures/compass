/** A job's site address split the way the project intake form asks for it. */
export type AddressParts = {
  readonly streetNumber: string | null
  readonly streetName: string | null
  readonly cityStateZip: string | null
}

/**
 * Splits "1503 Cornucopia, Leadville, CO 80461" into street number, street
 * name and the rest. Addresses that don't start with a number keep the whole
 * first part as the street name; anything after the first comma is the city,
 * state and ZIP.
 */
export function splitAddress(address: string | null): AddressParts {
  const text = address?.trim() ?? ""
  if (!text) return { streetNumber: null, streetName: null, cityStateZip: null }
  const comma = text.indexOf(",")
  const street = (comma === -1 ? text : text.slice(0, comma)).trim()
  const rest = comma === -1 ? "" : text.slice(comma + 1).trim()
  const match = street.match(/^(\d+[A-Za-z]?)\s+(.+)$/)
  return {
    streetNumber: match?.[1] ?? null,
    streetName: (match?.[2] ?? street) || null,
    cityStateZip: rest || null,
  }
}
