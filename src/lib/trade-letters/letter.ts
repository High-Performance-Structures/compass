/**
 * Letters to selected trades: a letter of intent holds a trade's place before
 * the owner signs; the award letter accepts their quote in writing once the
 * owner has signed. Pure helpers shared by the server and the composer.
 */
import { TRADE_LETTER_STATUSES, TRADE_LETTER_KINDS, type TradeLetterKind, type TradeLetterStatus } from "@/lib/domain/trade-letters/statuses"
export type { TradeLetterKind, TradeLetterStatus }

export const TRADE_LETTER_KIND_LABELS: Readonly<Record<TradeLetterKind, string>> = {
  intent: "Letter of intent",
  award: "Award letter",
}

export const TRADE_LETTER_STATUS_LABELS: Readonly<Record<TradeLetterStatus, string>> = {
  draft: "Draft",
  preparing: "Ready to send in Foxit",
  sent: "Out for signature",
  signed: "Signed",
  declined: "Declined",
  cancelled: "Cancelled",
}

export function isTradeLetterKind(value: string): value is TradeLetterKind {
  return TRADE_LETTER_KINDS.some((kind) => kind === value)
}

export function isTradeLetterStatus(value: string): value is TradeLetterStatus {
  return TRADE_LETTER_STATUSES.some((status) => status === value)
}

export type TradeLetterScopeItem = {
  readonly costCode: string | null
  readonly description: string
  readonly amountCents: number
}

/** What a selected trade gets: a letter (subcontract work), a purchase order (material), or nothing (owner scope). */
export type TradeLetterRoute = "letter" | "purchase_order" | "none"

export function tradeLetterRoute(input: { readonly ownerScope: boolean; readonly sageCostTypes: readonly string[] }): TradeLetterRoute {
  if (input.ownerScope) return "none"
  if (input.sageCostTypes.length > 0 && input.sageCostTypes.every((type) => type === "material")) return "purchase_order"
  return "letter"
}

/**
 * Whether a letter of this kind can be written now. An award letter waits for
 * the owner's signature; a letter of intent is only for before that.
 */
export function tradeLetterAvailability(kind: TradeLetterKind, ownerSigned: boolean): { readonly allowed: true } | { readonly allowed: false; readonly reason: string } {
  if (kind === "award" && !ownerSigned) {
    return { allowed: false, reason: "The award letter unlocks once the owner signs. Send a letter of intent until then." }
  }
  if (kind === "intent" && ownerSigned) {
    return { allowed: false, reason: "The owner has signed, so send the award letter instead." }
  }
  return { allowed: true }
}

/** Fills {token} placeholders; unknown tokens are left as written. */
export function fillLetterText(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{([a-z]+)\}/g, (whole, key: string) => (Object.hasOwn(values, key) ? values[key] ?? whole : whole))
}

/** "A, B and C". */
export function joinWithAnd(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ""
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
}

/** AW-0001 / LOI-0001, numbered per company and kind. */
export function tradeLetterNumber(kind: TradeLetterKind, sequence: number): string {
  return `${kind === "award" ? "AW" : "LOI"}-${String(Math.max(1, sequence)).padStart(4, "0")}`
}

/** The next sequence after the highest existing number of this kind. */
export function nextTradeLetterSequence(kind: TradeLetterKind, existing: readonly string[]): number {
  const prefix = kind === "award" ? "AW-" : "LOI-"
  let highest = 0
  for (const number of existing) {
    if (!number.startsWith(prefix)) continue
    const value = Number(number.slice(prefix.length))
    if (Number.isInteger(value) && value > highest) highest = value
  }
  return highest + 1
}

export function parseScope(json: string): readonly TradeLetterScopeItem[] {
  try {
    const value: unknown = JSON.parse(json)
    if (!Array.isArray(value)) return []
    return value.flatMap((item): TradeLetterScopeItem[] => {
      if (!item || typeof item !== "object") return []
      const costCode: unknown = Reflect.get(item, "costCode")
      const description: unknown = Reflect.get(item, "description")
      const amountCents: unknown = Reflect.get(item, "amountCents")
      if (typeof description !== "string" || typeof amountCents !== "number") return []
      return [{ costCode: typeof costCode === "string" ? costCode : null, description, amountCents }]
    })
  } catch {
    return []
  }
}

export function parseStringList(json: string | null): readonly string[] {
  if (!json) return []
  try {
    const value: unknown = JSON.parse(json)
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}

export function longDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!match) return iso
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })
}
