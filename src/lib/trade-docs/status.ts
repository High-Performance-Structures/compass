import type { TradeDocType } from "@/lib/trade-docs/settings"

/** A vendor's current (not superseded) document of one type. */
export type TradeDocOnFile = {
  readonly id: string
  readonly docType: string
  readonly kind: "document" | "waiver"
  readonly fileName: string | null
  readonly webUrl: string | null
  readonly effectiveOn: string | null
  readonly expiresOn: string | null
  readonly checks: readonly string[]
  readonly notes: string | null
  readonly source: string
  readonly createdAt: string
  readonly createdByName: string
}
export type TradeDocState =
  | "missing"
  | "expired"
  | "needs_date"
  | "expiring"
  | "on_file"
  | "waived"

export type TradeDocLine = {
  readonly type: TradeDocType
  readonly required: boolean
  readonly state: TradeDocState
  readonly doc: TradeDocOnFile | null
  /** Days until expiry (negative once expired); null when it doesn't expire. */
  readonly daysLeft: number | null
}

export type TradeDocSummary = {
  readonly lines: readonly TradeDocLine[]
  readonly requiredCount: number
  /** Required documents that are good today (expiring soon still counts). */
  readonly goodCount: number
  /** Required documents that are missing or expired. */
  readonly owed: readonly TradeDocLine[]
  readonly expiringCount: number
  readonly complete: boolean
}

const DAY_MS = 86_400_000

function dayNumber(isoDate: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate)
  if (!match) return null
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS)
}

function isRequiredFor(type: TradeDocType, vendorCategory: string | null): boolean {
  const category = vendorCategory?.trim().toLowerCase() ?? ""
  return category.length > 0 && type.requiredFor.some((item) => item.trim().toLowerCase() === category)
}

function stateOf(type: TradeDocType, doc: TradeDocOnFile | null, today: number): { readonly state: TradeDocState; readonly daysLeft: number | null } {
  if (!doc) return { state: "missing", daysLeft: null }
  if (doc.kind === "waiver") return { state: "waived", daysLeft: null }
  if (!type.expires) return { state: "on_file", daysLeft: null }
  const expires = doc.expiresOn ? dayNumber(doc.expiresOn) : null
  if (expires === null) return { state: "needs_date", daysLeft: null }
  const daysLeft = expires - today
  if (daysLeft < 0) return { state: "expired", daysLeft }
  if (daysLeft <= type.remindDaysBefore) return { state: "expiring", daysLeft }
  return { state: "on_file", daysLeft }
}

/**
 * Where a vendor stands on trade docs today: one line per active document
 * type that is required for its category or already on file.
 */
export function summarizeTradeDocs(input: {
  readonly docTypes: readonly TradeDocType[]
  readonly vendorCategory: string | null
  readonly docs: readonly TradeDocOnFile[]
  readonly today: string
}): TradeDocSummary {
  const today = dayNumber(input.today) ?? Math.floor(Date.now() / DAY_MS)
  // Newest first, so a type's first match is its current document.
  const docs = [...input.docs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const lines = input.docTypes.flatMap((type): TradeDocLine[] => {
    const required = type.active && isRequiredFor(type, input.vendorCategory)
    const doc = docs.find((item) => item.docType === type.id) ?? null
    if (!required && !doc) return []
    return [{ type, required, doc, ...stateOf(type, doc, today) }]
  })
  const required = lines.filter((line) => line.required)
  const owed = required.filter((line) => line.state === "missing" || line.state === "expired")
  return {
    lines,
    requiredCount: required.length,
    goodCount: required.length - owed.length,
    owed,
    expiringCount: required.filter((line) => line.state === "expiring").length,
    complete: owed.length === 0,
  }
}

export const TRADE_DOC_STATE_LABELS: Readonly<Record<TradeDocState, string>> = {
  missing: "Missing",
  expired: "Expired",
  needs_date: "Needs expiry date",
  expiring: "Expiring soon",
  on_file: "On file",
  waived: "Alternative on file",
}

/** "3 of 5 on file", or "Not required" when nothing is required. */
export function tradeDocCountLabel(summary: TradeDocSummary): string {
  if (summary.requiredCount === 0) return "Not required"
  return `${summary.goodCount} of ${summary.requiredCount} on file`
}
