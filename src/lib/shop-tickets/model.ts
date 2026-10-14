import type { ShopTicketRateKind } from "@/db/schema-shop-tickets"

/** A line as it is edited, before it is saved. */
export type ShopTicketLineInput = {
  readonly costCode: string
  readonly description: string
  readonly rateKind: ShopTicketRateKind
  readonly hours: number
  /** The rate book entry the line bills at; null picks the only rate of its kind. */
  readonly rateBookEntryId: string | null
}

export type ShopTicketRate = {
  readonly rateBookEntryId: string
  readonly kind: ShopTicketRateKind
  readonly name: string
  readonly rateCents: number
}

/** The rate book's active labor and machine rates, by name. */
export type ShopTicketRates = readonly ShopTicketRate[]

export type PricedShopTicketLine = ShopTicketLineInput & {
  readonly rateCents: number
  readonly amountCents: number
  readonly rateBookEntryId: string
  readonly outsideBudget: boolean
}

export type PricingResult =
  | { readonly ok: true; readonly lines: readonly PricedShopTicketLine[]; readonly totalCents: number }
  | { readonly ok: false; readonly error: string }

const RATE_KIND_LABEL: { readonly [K in ShopTicketRateKind]: string } = { labor: "Labor", machine: "Machine" }

export function rateKindLabel(kind: ShopTicketRateKind): string {
  return RATE_KIND_LABEL[kind]
}

/**
 * The rate a line bills at: the rate book entry it names, or the only active
 * rate of its kind. Null when the entry is gone or there is a choice to make.
 */
export function resolveShopTicketRate(
  rates: ShopTicketRates,
  kind: ShopTicketRateKind,
  rateBookEntryId: string | null,
): ShopTicketRate | null {
  const ofKind = rates.filter((rate) => rate.kind === kind)
  if (rateBookEntryId) return ofKind.find((rate) => rate.rateBookEntryId === rateBookEntryId) ?? null
  return ofKind.length === 1 ? (ofKind[0] ?? null) : null
}

/** Hours are kept to two decimals, the same precision Sage reports. */
export function roundHours(hours: number): number {
  return Math.round(hours * 100) / 100
}

/** Billed amount for a line: hours at the set rate, rounded to the cent. */
export function lineAmountCents(hours: number, rateCents: number): number {
  return Math.round(roundHours(hours) * rateCents)
}

/**
 * Prices every line at the rate book rate it names. The rate is
 * copied onto the line so a later rate change never alters an issued ticket.
 */
export function priceShopTicketLines(
  lines: readonly ShopTicketLineInput[],
  rates: ShopTicketRates,
  budgetCostCodes: ReadonlySet<string> | null,
): PricingResult {
  const priced: PricedShopTicketLine[] = []
  for (const [index, line] of lines.entries()) {
    const costCode = line.costCode.trim()
    if (!costCode) return { ok: false, error: `Line ${index + 1} needs a cost code.` }
    if (!Number.isFinite(line.hours) || line.hours <= 0) {
      return { ok: false, error: `Line ${index + 1} needs hours greater than zero.` }
    }
    if (line.hours > 2000) return { ok: false, error: `Line ${index + 1} has more hours than one ticket can bill.` }
    const rate = resolveShopTicketRate(rates, line.rateKind, line.rateBookEntryId)
    if (!rate) {
      const kind = rateKindLabel(line.rateKind).toLowerCase()
      return {
        ok: false,
        error: rates.some((candidate) => candidate.kind === line.rateKind)
          ? `Line ${index + 1} needs a ${kind} rate. Choose one from the rate book.`
          : `There is no ${kind} rate yet. Add one in Settings → Rate book.`,
      }
    }
    const hours = roundHours(line.hours)
    priced.push({
      costCode,
      description: line.description.trim(),
      rateKind: line.rateKind,
      hours,
      rateBookEntryId: rate.rateBookEntryId,
      rateCents: rate.rateCents,
      amountCents: lineAmountCents(hours, rate.rateCents),
      outsideBudget: isOutsideBudget(costCode, budgetCostCodes),
    })
  }
  return { ok: true, lines: priced, totalCents: priced.reduce((sum, line) => sum + line.amountCents, 0) }
}

/** Cost codes compare on their digits, so "01 71 13" and "017113" match. */
export function normalizeCostCode(code: string): string {
  return code.replace(/[^0-9a-z.]/gi, "").toLowerCase()
}

/** Projects without a budget skip the check (null set). */
export function isOutsideBudget(costCode: string, budgetCostCodes: ReadonlySet<string> | null): boolean {
  if (!budgetCostCodes || budgetCostCodes.size === 0) return false
  return !budgetCostCodes.has(normalizeCostCode(costCode))
}

export function budgetCostCodeSet(codes: readonly string[]): ReadonlySet<string> | null {
  const set = new Set(codes.map(normalizeCostCode).filter((code) => code.length > 0))
  return set.size > 0 ? set : null
}

export function formatTicketNumber(prefix: string, sequenceNumber: number): string {
  const clean = prefix.trim()
  return clean ? `${clean}-${sequenceNumber}` : String(sequenceNumber)
}

/** The next number: one past the highest used, and never below the company's starting number. */
export function nextSequenceNumber(highestUsed: number | null, startNumber: number): number {
  return Math.max((highestUsed ?? 0) + 1, startNumber)
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const

/** "2026-09-01" → { name: "September", year: 2026 }, or null. */
function monthParts(month: string | null): { readonly name: string; readonly year: number } | null {
  const match = month?.match(/^(\d{4})-(\d{2})/)
  if (!match) return null
  const index = Number(match[2]) - 1
  const name = MONTHS[index]
  return name ? { name, year: Number(match[1]) } : null
}

export function payApplicationLabel(number: number | null, month: string | null): string | null {
  const parts = monthParts(month)
  if (number === null && !parts) return null
  const monthText = parts ? `${parts.name} ${parts.year}` : null
  if (number === null) return monthText
  return monthText ? `Pay app ${number} · ${monthText}` : `Pay app ${number}`
}

/**
 * The draw folder under the project's pay requests folder, following the
 * department template's "PayApplication-SequentialNumber-Month-4digityear".
 */
export function payApplicationFolderName(number: number | null, month: string | null): string | null {
  const parts = monthParts(month)
  if (number === null || !parts) return null
  return `PayApplication-${String(number).padStart(2, "0")}-${parts.name}-${parts.year}`
}

/** Older draw folders were named "September 2026"; they still count as the draw's folder. */
export function legacyPayApplicationFolderNames(month: string | null): readonly string[] {
  const parts = monthParts(month)
  return parts ? [`${parts.name} ${parts.year}`] : []
}

/** The receipts folder inside a draw folder, from the department template. */
export const PAY_APPLICATION_RECEIPTS_FOLDER = "ExpensesReceipts"
export const LEGACY_RECEIPTS_FOLDER_NAMES: readonly string[] = ["Receipts"]

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
}
