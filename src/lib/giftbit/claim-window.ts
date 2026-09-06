const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1_000

// Giftbit permits promotional claim periods up to one year and treats the
// date as valid through the end of the Pacific day. This two-day offset leaves
// a full-day safety margin for timezone, inclusive-day, and leap-year edges.
export const GIFTBIT_CLAIM_WINDOW_DAYS = 363

export function giftbitClaimExpiryDate(releasedAt: string): string {
  const released = new Date(releasedAt)
  if (Number.isNaN(released.getTime())) {
    throw new Error("A valid release date is required for the Giftbit claim window.")
  }
  return new Date(
    released.getTime() + GIFTBIT_CLAIM_WINDOW_DAYS * DAY_IN_MILLISECONDS,
  )
    .toISOString()
    .slice(0, 10)
}

export function formatGiftbitClaimExpiry(expiresOn: string): string {
  const date = new Date(`${expiresOn}T12:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return expiresOn
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(date)
}
