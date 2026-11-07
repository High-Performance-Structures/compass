import { canonicalFeeCostCode } from "@/lib/domain/financials/builder-fee-codes"
import type { SageChangeOrderSettings } from "@/lib/feature-settings/sage-change-order-settings"
import type { SageCostCodeMapping } from "@/lib/financials/sage-export-codes"
import { formatSageInvoiceNumber } from "@/lib/financials/sage-invoice-number"

/*
 * Pure rules for sending a change order or variance to Sage 100 Contractor as
 * an approved prime change order (ChangeOrderAddRq): its Sage number and
 * description, one line per cost code (never merged with another change
 * order), what stops a send, and whether Sage already has it. No database
 * or network access here.
 */

/** Sage's limits: ChangeOrderNumber is String20, Desc (header and line) String50. */
const SAGE_CHANGE_ORDER_NUMBER_MAX = 20
const SAGE_CHANGE_ORDER_DESCRIPTION_MAX = 50

/** Statuses at which a change order or variance is approved and can go to Sage. */
const SENDABLE_STATUSES: ReadonlySet<string> = new Set(["executed", "sage_pending", "synced", "closed"])

export type SageChangeOrderSource = {
  readonly id: string
  readonly recordType: "change_order" | "variance"
  readonly number: string
  readonly title: string
  readonly status: string
  /** ISO timestamp the change order was executed, or null. */
  readonly executedAt: string | null
  /** The owner's acceptance date (YYYY-MM-DD) when recorded by hand. */
  readonly acceptedOn: string | null
  readonly sageRecordId: string | null
  readonly lines: readonly {
    readonly costCode: string | null
    readonly description: string
    readonly amountCents: number | null
  }[]
}

type SageChangeOrderLinePlan = {
  readonly costCode: string
  readonly description: string
  readonly sageCostCodeName: string | null
  /** Sage's cost code record number ("1310000"), or null when Compass doesn't know it. */
  readonly sageCostCodeRecord: string | null
  readonly costTypeNumber: number
  readonly amountCents: number
}

export type SageChangeOrderPlan = {
  readonly changeOrderId: string
  readonly recordType: "change_order" | "variance"
  readonly compassNumber: string
  /** "14" or "V-006": the Compass number with a variance's prefix. */
  readonly sageName: string
  /** Suggested Sage change order number from the company's format. */
  readonly suggestedNumber: string
  readonly date: string | null
  readonly description: string
  readonly statusNumber: number
  readonly lines: readonly SageChangeOrderLinePlan[]
  readonly totalCents: number
  /** Why this change order can't be sent; empty when it can. */
  readonly blockers: readonly string[]
}

/** The change order's name in Sage: variances carry a "V-" prefix. */
export function sageChangeOrderName(number: string, recordType: "change_order" | "variance"): string {
  const trimmed = number.trim()
  if (recordType !== "variance") return trimmed
  return /^v-/i.test(trimmed) ? `V-${trimmed.slice(2)}` : `V-${trimmed}`
}

/** Whitespace collapsed and cut to Sage's 50 characters without splitting a character. */
export function sageDescription(value: string, max: number = SAGE_CHANGE_ORDER_DESCRIPTION_MAX): string {
  const collapsed = value.replaceAll(/\s+/g, " ").trim()
  const characters = Array.from(collapsed)
  return characters.length <= max ? collapsed : characters.slice(0, max).join("").trimEnd()
}

/** The date Sage records: the owner's acceptance date, else the executed date. */
function sageChangeOrderDate(source: Pick<SageChangeOrderSource, "acceptedOn" | "executedAt">): string | null {
  const candidate = source.acceptedOn ?? source.executedAt
  if (!candidate) return null
  const date = candidate.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null
}

function fillDescription(format: string, input: { readonly name: string; readonly title: string }): string {
  return format.replaceAll(/\{(name|title)\}/g, (_token, key: string) => (key === "name" ? input.name : input.title))
}

/** "1234.56" (or "-12.50") for Sage's decimal amounts, from integer cents. */
export function sageAmount(cents: number): string {
  const sign = cents < 0 ? "-" : ""
  const absolute = Math.abs(Math.round(cents))
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`
}

/**
 * Plans one change order for Sage: one line per cost code with that cost
 * code's total in this change order only.
 */
export function planSageChangeOrder(
  source: SageChangeOrderSource,
  input: {
    readonly settings: SageChangeOrderSettings
    readonly projectNumber: string | null
    readonly sageJobNumber: string | null
    readonly mapCostCode: (costCode: string) => SageCostCodeMapping
  }
): SageChangeOrderPlan {
  const { settings } = input
  const blockers: string[] = []
  const sageName = sageChangeOrderName(source.number, source.recordType)
  const number = formatSageInvoiceNumber(settings.numberFormat, {
    projectNumber: input.projectNumber,
    sageJobNumber: input.sageJobNumber,
    number: sageName,
  })
  if (!SENDABLE_STATUSES.has(source.status)) {
    blockers.push(source.recordType === "variance" ? "The variance isn't approved yet." : "The change order isn't executed yet.")
  }
  if (!input.sageJobNumber) blockers.push("The project isn't linked to a Sage job.")
  const date = sageChangeOrderDate(source)
  if (!date) blockers.push("The change order has no executed date.")

  const byCode = new Map<string, { description: string; amountCents: number }>()
  let missingCode = false
  for (const line of source.lines) {
    if (line.amountCents === null || line.amountCents === 0) continue
    const code = line.costCode?.trim()
    if (!code) {
      missingCode = true
      continue
    }
    const key = canonicalFeeCostCode(code)
    const entry = byCode.get(key)
    if (entry) entry.amountCents += line.amountCents
    else byCode.set(key, { description: line.description, amountCents: line.amountCents })
  }
  if (missingCode) blockers.push("A line with an amount has no cost code.")

  const description = sageDescription(
    fillDescription(source.recordType === "variance" ? settings.varianceDescriptionFormat : settings.changeOrderDescriptionFormat, {
      name: sageName,
      title: source.title,
    })
  )
  if (!description) blockers.push("The change order has no title for Sage's description.")

  const lines: SageChangeOrderLinePlan[] = []
  for (const [costCode, entry] of byCode) {
    if (entry.amountCents === 0) continue
    const mapping = input.mapCostCode(costCode)
    if (mapping.status === "unmapped") blockers.push(`${costCode}: ${mapping.reason}`)
    else if (!mapping.sageRecordNumber) blockers.push(`${costCode}: Compass doesn't know Sage's record number for ${mapping.sageName}.`)
    lines.push({
      costCode,
      description: sageDescription(entry.description || description) || description,
      sageCostCodeName: mapping.status === "mapped" ? mapping.sageName : null,
      sageCostCodeRecord: mapping.status === "mapped" ? mapping.sageRecordNumber : null,
      costTypeNumber: settings.costTypeNumber,
      amountCents: entry.amountCents,
    })
  }
  if (lines.length === 0 && !missingCode) blockers.push("The change order has no lines with an amount.")

  return {
    changeOrderId: source.id,
    recordType: source.recordType,
    compassNumber: source.number,
    sageName,
    suggestedNumber: number.value,
    date,
    description,
    statusNumber: settings.approvedStatusNumber,
    lines,
    totalCents: lines.reduce((sum, line) => sum + line.amountCents, 0),
    blockers,
  }
}

/** Sage's own prime change order, as Compass's read-only copy holds it. */
export type SagePrimeChangeOrderRow = {
  readonly sageRecordId: string
  readonly changeOrderNumber: string
  readonly description: string
  readonly approvedAmountCents: number
}

function key(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim().toLowerCase()
}

/** Why Sage would refuse `number` for this job, or null when it's fine. */
export function sageChangeOrderNumberError(
  number: string,
  taken: { readonly sageNumbers: readonly string[]; readonly compassNumbers: readonly string[] }
): string | null {
  const trimmed = number.trim()
  if (!trimmed) return "Enter the Sage change order number."
  if (trimmed.length > SAGE_CHANGE_ORDER_NUMBER_MAX) {
    return `Sage allows ${SAGE_CHANGE_ORDER_NUMBER_MAX} characters; this number has ${trimmed.length}.`
  }
  if (taken.sageNumbers.some((existing) => key(existing) === key(trimmed))) return `Sage already has change order ${trimmed} on this job.`
  if (taken.compassNumbers.some((existing) => key(existing) === key(trimmed))) {
    return `Another change order on this job is already being sent to Sage as ${trimmed}.`
  }
  return null
}

export type SageChangeOrderState =
  | { readonly state: "unknown" }
  | { readonly state: "not_in_sage" }
  | { readonly state: "in_sage"; readonly sageRecordId: string; readonly sageNumber: string }
  | {
      readonly state: "differs"
      readonly sageRecordId: string
      readonly sageNumber: string
      readonly sageAmountCents: number
    }

/**
 * Whether Sage already has this change order: by the Sage record Compass
 * stored, else by number (the Compass number, its Sage name, or the number
 * sent), else by description. A match with another amount "differs".
 * `rows` is null when Compass hasn't read the job's change orders yet.
 */
export function sageChangeOrderState(
  input: {
    readonly sageRecordId: string | null
    readonly numbers: readonly string[]
    readonly descriptions: readonly string[]
    readonly amountCents: number
  },
  rows: readonly SagePrimeChangeOrderRow[] | null
): SageChangeOrderState {
  if (rows === null) return { state: "unknown" }
  const numbers = new Set(input.numbers.map(key).filter(Boolean))
  const descriptions = new Set(input.descriptions.map(key).filter(Boolean))
  const match =
    (input.sageRecordId ? rows.find((row) => row.sageRecordId === input.sageRecordId) : undefined) ??
    rows.find((row) => numbers.has(key(row.changeOrderNumber))) ??
    rows.find((row) => descriptions.has(key(row.description)))
  if (!match) return { state: "not_in_sage" }
  if (match.approvedAmountCents === input.amountCents) {
    return { state: "in_sage", sageRecordId: match.sageRecordId, sageNumber: match.changeOrderNumber }
  }
  return { state: "differs", sageRecordId: match.sageRecordId, sageNumber: match.changeOrderNumber, sageAmountCents: match.approvedAmountCents }
}
