import type { BracingRentalSettings } from "@/lib/feature-settings/registry"

/** reserved: planned, not yet out. out: signed out to the job. returned: checked back in. */
const BRACING_RENTAL_STATUSES = ["reserved", "out", "returned"] as const
export type BracingRentalStatus = (typeof BRACING_RENTAL_STATUSES)[number]

export function isBracingRentalStatus(value: string): value is BracingRentalStatus {
  return BRACING_RENTAL_STATUSES.some((status) => status === value)
}

export type BracingLine = {
  readonly itemKey: string
  readonly size: string
  readonly quantityOut: number
  readonly quantityReturned: number
  readonly quantityDamaged: number
  readonly damageCents: number
}

const DAY_MS = 86_400_000

function dayNumber(isoDate: string): number | null {
  const time = Date.parse(`${isoDate}T12:00:00Z`)
  return Number.isNaN(time) ? null : Math.round(time / DAY_MS)
}

/**
 * Calendar days the bracing was out, counting the day it went out and the
 * day it came back; until it is returned, through `today`.
 */
export function bracingRentalDays(signedOutOn: string | null, returnedOn: string | null, today: string): number {
  if (!signedOutOn) return 0
  const start = dayNumber(signedOutOn)
  const end = dayNumber(returnedOn ?? today)
  if (start === null || end === null || end < start) return 0
  return end - start + 1
}

export type BracingCharges = {
  readonly braces: number
  readonly days: number
  readonly rentCents: number
  readonly damageCents: number
  readonly depositCents: number
  /** Rent and damage less the deposit; negative when the deposit covers more. */
  readonly balanceCents: number
}

/** Rent (braces x days x rate), damage and the balance after the deposit. */
export function bracingCharges(input: {
  readonly lines: readonly BracingLine[]
  readonly billedItemKey: string
  readonly dailyRateCents: number
  readonly days: number
  readonly depositCents: number
}): BracingCharges {
  const braces = input.lines.filter((line) => line.itemKey === input.billedItemKey).reduce((sum, line) => sum + line.quantityOut, 0)
  const rentCents = braces * input.days * input.dailyRateCents
  const damageCents = input.lines.reduce((sum, line) => sum + line.damageCents, 0)
  return {
    braces,
    days: input.days,
    rentCents,
    damageCents,
    depositCents: input.depositCents,
    balanceCents: rentCents + damageCents - input.depositCents,
  }
}

/** What still has to happen before bracing can be signed out, as instructions. */
export function bracingSignOutIssues(input: {
  readonly settings: Pick<BracingRentalSettings, "minDepositPercent" | "requireIdCopy">
  readonly idCopyReceived: boolean
  readonly depositCents: number
  /** Expected rent for the planned days; deposit is checked against it. */
  readonly expectedRentCents: number
  readonly quantityOut: number
}): readonly string[] {
  const issues: string[] = []
  if (input.quantityOut <= 0) issues.push("Enter the quantities going out.")
  if (input.settings.requireIdCopy && !input.idCopyReceived) issues.push("Get a copy of the renter's ID or driver's license.")
  const required = Math.ceil((input.expectedRentCents * input.settings.minDepositPercent) / 100)
  if (input.depositCents < required) {
    issues.push(`Collect a deposit of at least ${input.settings.minDepositPercent}% of the expected rent (${formatCents(required)}).`)
  }
  return issues
}

/** Owned less what is out on rentals, per item and size. Negative means over-committed. */
export function bracingAvailability(
  items: BracingRentalSettings["items"],
  sizes: readonly string[],
  outLines: readonly Pick<BracingLine, "itemKey" | "size" | "quantityOut" | "quantityReturned">[],
): readonly { readonly itemKey: string; readonly label: string; readonly size: string; readonly owned: number; readonly out: number; readonly available: number }[] {
  const outBy = new Map<string, number>()
  for (const line of outLines) {
    const key = `${line.itemKey}|${line.size}`
    outBy.set(key, (outBy.get(key) ?? 0) + Math.max(0, line.quantityOut - line.quantityReturned))
  }
  return items.flatMap((item) =>
    (sizes.length > 0 ? sizes : [""]).flatMap((size) => {
      const owned = item.owned[size] ?? 0
      const out = outBy.get(`${item.key}|${size}`) ?? 0
      return owned === 0 && out === 0 ? [] : [{ itemKey: item.key, label: item.label, size, owned, out, available: owned - out }]
    }),
  )
}

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
}
