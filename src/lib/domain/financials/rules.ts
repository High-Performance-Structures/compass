/**
 * Pure financial rules (architecture standard, sections 1 and 5): line-item
 * math and the stored totals derived from it. The invoice, bill and credit
 * memo dialogs preview with these functions and the server recomputes the
 * stored totals with the same ones, so a total sent by the browser is never
 * trusted. Amounts here are dollars (the financial tables store `real`
 * dollar columns), not cents.
 */

import { parseDateOnly } from "@/lib/format"

export type LineItem = {
  description: string
  quantity: number
  rate: number
  amount: number
}

/** quantity × rate, as the line editor has always computed it. */
export function lineAmount(quantity: number, rate: number): number {
  return quantity * rate
}

/** The editor's number parsing: blank or invalid input counts as 0. */
export function parseLineNumber(raw: string): number {
  return parseFloat(raw) || 0
}

/** Sum of line amounts, in line order (same float result as the dialogs). */
export function lineItemsSubtotal(lines: readonly Pick<LineItem, "amount">[]): number {
  return lines.reduce((sum, line) => sum + line.amount, 0)
}

export type BillTotals = {
  readonly subtotal: number
  readonly total: number
  readonly amountDue: number
}

/** Invoice and vendor bill totals: subtotal + tax, less what was paid. */
export function billTotals(subtotal: number, tax: number, amountPaid: number): BillTotals {
  const total = subtotal + tax
  return { subtotal, total, amountDue: total - amountPaid }
}

export type CreditMemoTotals = {
  readonly total: number
  readonly amountRemaining: number
}

/** Credit memo totals: the lines, less what was applied. */
export function creditMemoTotals(total: number, amountApplied: number): CreditMemoTotals {
  return { total, amountRemaining: total - amountApplied }
}

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function isObject(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Reads stored or submitted line items JSON. Each line's amount is
 * recomputed from its quantity and rate, so the subtotal follows from the
 * inputs. Returns null when the text is not a JSON array of line objects.
 */
export function parseLineItems(text: string | null | undefined): LineItem[] | null {
  if (text === null || text === undefined || text === "") return []
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null
  const lines: LineItem[] = []
  for (const entry of parsed) {
    if (!isObject(entry)) return null
    const quantity = finite(entry.quantity)
    const rate = finite(entry.rate)
    lines.push({
      description: typeof entry.description === "string" ? entry.description : "",
      quantity,
      rate,
      amount: lineAmount(quantity, rate),
    })
  }
  return lines
}

/** Line items as stored: the same key order the editor has always written. */
export function serializeLineItems(lines: readonly LineItem[]): string {
  return JSON.stringify(
    lines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      rate: line.rate,
      amount: line.amount,
    })),
  )
}

/**
 * A financial date in the viewer's locale, as the tables have always shown it
 * ("9/1/2026"). Date-only values ("YYYY-MM-DD") are calendar dates: they used
 * to parse as UTC midnight and so showed the previous day west of UTC.
 */
export function localeDateText(value: string): string {
  const date = parseDateOnly(value) ?? new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

export type DerivedTotals<T> =
  | { readonly ok: true; readonly values: T | null }
  | { readonly ok: false; readonly error: string }

export const INVALID_LINE_ITEMS = "Line items are not valid."

type BillTotalsInput = {
  readonly lineItems?: string | null
  readonly subtotal?: number
  readonly tax?: number
  readonly total?: number
  readonly amountPaid?: number
  readonly amountDue?: number
}

type StoredBillTotals = {
  readonly lineItems: string | null
  readonly subtotal: number
  readonly tax: number
  readonly amountPaid: number
}

export type BillTotalsValues = BillTotals & { readonly lineItems?: string }

function hasAnyKey(input: object, keys: readonly string[]): boolean {
  return keys.some((key) => key in input)
}

function subtotalFrom(text: string | null, fallback: number): number | null {
  if (text === null) return fallback
  const lines = parseLineItems(text)
  return lines === null ? null : lineItemsSubtotal(lines)
}

function normalizedLines(lineItems: string | null | undefined): { readonly lineItems?: string } {
  if (typeof lineItems !== "string") return {}
  const lines = parseLineItems(lineItems)
  return lines ? { lineItems: serializeLineItems(lines) } : {}
}

/**
 * The stored subtotal, total and amount due of an invoice or vendor bill,
 * recomputed on the server from the lines, tax and amount paid (submitted
 * values over stored ones). Client-sent subtotal/total/amountDue are
 * replaced. `values` is null for an update that touches none of these
 * fields, which leaves the stored totals alone. Without line items the
 * stored subtotal is kept (0 for a new record). Pass `stored: null` when
 * creating.
 */
export function deriveBillTotals(
  input: BillTotalsInput,
  stored: StoredBillTotals | null,
): DerivedTotals<BillTotalsValues> {
  const keys = ["lineItems", "subtotal", "tax", "total", "amountPaid", "amountDue"]
  if (stored && !hasAnyKey(input, keys)) return { ok: true, values: null }
  const text = typeof input.lineItems === "string" ? input.lineItems : (stored?.lineItems ?? null)
  const subtotal = subtotalFrom(text, stored?.subtotal ?? 0)
  if (subtotal === null) return { ok: false, error: INVALID_LINE_ITEMS }
  const totals = billTotals(subtotal, input.tax ?? stored?.tax ?? 0, input.amountPaid ?? stored?.amountPaid ?? 0)
  return { ok: true, values: { ...totals, ...normalizedLines(input.lineItems) } }
}

type CreditMemoTotalsInput = {
  readonly lineItems?: string | null
  readonly total?: number
  readonly amountApplied?: number
  readonly amountRemaining?: number
}

type StoredCreditMemoTotals = {
  readonly lineItems: string | null
  readonly total: number
  readonly amountApplied: number
}

export type CreditMemoTotalsValues = CreditMemoTotals & { readonly lineItems?: string }

/** Credit memo total and amount remaining, recomputed like deriveBillTotals. */
export function deriveCreditMemoTotals(
  input: CreditMemoTotalsInput,
  stored: StoredCreditMemoTotals | null,
): DerivedTotals<CreditMemoTotalsValues> {
  const keys = ["lineItems", "total", "amountApplied", "amountRemaining"]
  if (stored && !hasAnyKey(input, keys)) return { ok: true, values: null }
  const text = typeof input.lineItems === "string" ? input.lineItems : (stored?.lineItems ?? null)
  const total = subtotalFrom(text, stored?.total ?? 0)
  if (total === null) return { ok: false, error: INVALID_LINE_ITEMS }
  const totals = creditMemoTotals(total, input.amountApplied ?? stored?.amountApplied ?? 0)
  return { ok: true, values: { ...totals, ...normalizedLines(input.lineItems) } }
}
