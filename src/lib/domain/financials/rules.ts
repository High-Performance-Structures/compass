/**
 * Pure financial rules (architecture standard, sections 1 and 5): line-item
 * math and the stored totals derived from it. The invoice, bill and credit
 * memo dialogs preview with these functions and the server recomputes the
 * stored totals with the same ones, so a total sent by the browser is never
 * trusted. Line and total amounts here are dollars (the financial tables
 * store `real` dollar columns); received-payment math below is in cents.
 */

import { formatCents, parseDateOnly } from "@/lib/format"
import type { ReceivableItemKind, ReceivablePaidState } from "@/lib/domain/financials/statuses"

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

// ---------------------------------------------------------------------------
// Contract budget revisions. Each rebuild of a project's contract budget is a
// numbered revision; exactly one per project is "current".
// ---------------------------------------------------------------------------

/** The number the next revision takes: one past the project's highest, from 1. */
export function nextContractBudgetRevisionNumber(latestRevisionNumber: number | null | undefined): number {
  return (latestRevisionNumber ?? 0) + 1
}

/** The id of the budget projection (budget view row) built for a revision. */
export function contractBudgetProjectionId(revisionId: string): string {
  return `contract-budget-view:${revisionId}`
}

/** The label the revision's budget projection carries, e.g. "Contract Budget R3". */
export function contractBudgetApplicationNumber(revisionNumber: number): string {
  return `Contract Budget R${revisionNumber}`
}

/**
 * What a rebuild does when a revision with the same source hash exists:
 * - "unchanged": that revision is already current, nothing to do.
 * - "reuse": it was prepared but never published; publish it (or hand it back
 *   unpublished when the caller activates it in its own batch).
 * - "build": no matching revision, so a new one is numbered and built.
 */
export type ContractBudgetRevisionPlan = "unchanged" | "reuse" | "build"

export function contractBudgetRevisionPlan(matchingStatus: string | null | undefined): ContractBudgetRevisionPlan {
  if (matchingStatus === "current") return "unchanged"
  if (matchingStatus === "building") return "reuse"
  return "build"
}

// ---------------------------------------------------------------------------
// Received payments applied to pay applications and invoices. All amounts are
// integer cents computed on the server from stored values: a pay
// application's billed amount is its current payment due; an invoice's is its
// total, and what it shows paid stays authoritative (it keeps amounts staff
// typed before payments were applied).
// ---------------------------------------------------------------------------

/** A billed item as stored, with what is already paid on it. */
export type ReceivableItem = {
  readonly kind: ReceivableItemKind
  readonly id: string
  readonly label: string
  readonly billedCents: number
  readonly paidCents: number
  readonly billingScope: string
  /** Where the item came from ("compass_contract_budget", "compass", "sage", ...). */
  readonly sourceSystem: string
}

export type RequestedAllocation = {
  readonly kind: ReceivableItemKind
  readonly id: string
  readonly cents: number
}

export type PlannedAllocation = RequestedAllocation & {
  readonly item: ReceivableItem
}

export type AllocationPlan =
  | {
      readonly ok: true
      readonly allocations: readonly PlannedAllocation[]
      readonly appliedCents: number
      readonly unappliedCents: number
    }
  | { readonly ok: false; readonly error: string }

/** Whole cents from stored dollars (the financial tables keep `real` dollars). */
export function storedDollarsToCents(dollars: number | null | undefined): number {
  return typeof dollars === "number" && Number.isFinite(dollars) ? Math.round(dollars * 100) : 0
}

/** What is still owed on an item; never negative. */
export function receivableOpenCents(item: Pick<ReceivableItem, "billedCents" | "paidCents">): number {
  return Math.max(item.billedCents - item.paidCents, 0)
}

/** Open, partially paid or paid, from the billed amount and what is paid. */
export function receivablePaidState(billedCents: number, paidCents: number): ReceivablePaidState {
  if (billedCents > 0 && paidCents >= billedCents) return "paid"
  return paidCents > 0 ? "partially_paid" : "open"
}

function isPositiveCents(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function itemKey(kind: ReceivableItemKind, id: string): string {
  return `${kind}:${id}`
}

/**
 * Checks where a payment goes before anything is written:
 * - the payment is a positive amount, and each applied amount is positive;
 * - every item is one of the customer's open items, listed once;
 * - no item gets more than its open balance;
 * - the applied amounts never exceed what the payment has unapplied;
 * - one payment stays on one billing scope (construction or preconstruction).
 * `alreadyAppliedCents` is what the payment has applied elsewhere (0 for a new payment).
 */
export function planPaymentAllocations(input: {
  readonly paymentCents: number
  readonly alreadyAppliedCents: number
  readonly openItems: readonly ReceivableItem[]
  readonly requested: readonly RequestedAllocation[]
}): AllocationPlan {
  if (!isPositiveCents(input.paymentCents)) return { ok: false, error: "Enter a payment amount greater than zero." }
  const requested = input.requested.filter((entry) => entry.cents !== 0)
  if (requested.length === 0) return { ok: false, error: "Apply the payment to at least one pay application or invoice." }
  const items = new Map(input.openItems.map((item) => [itemKey(item.kind, item.id), item]))
  const seen = new Set<string>()
  const allocations: PlannedAllocation[] = []
  let appliedCents = 0
  for (const entry of requested) {
    const key = itemKey(entry.kind, entry.id)
    if (seen.has(key)) return { ok: false, error: "Each pay application or invoice can be listed only once." }
    seen.add(key)
    const item = items.get(key)
    if (!item) return { ok: false, error: "That pay application or invoice is not open for this customer." }
    if (!isPositiveCents(entry.cents)) return { ok: false, error: `Enter an amount greater than zero for ${item.label}.` }
    const open = receivableOpenCents(item)
    if (entry.cents > open) {
      return { ok: false, error: `${item.label} has only ${formatCents(open)} open. Apply no more than that.` }
    }
    appliedCents += entry.cents
    allocations.push({ ...entry, item })
  }
  const scopes = new Set(allocations.map((allocation) => allocation.item.billingScope))
  if (scopes.size > 1) return { ok: false, error: "Apply one payment to construction or preconstruction billing, not both." }
  const available = Math.max(input.paymentCents - input.alreadyAppliedCents, 0)
  if (appliedCents > available) {
    return {
      ok: false,
      error: `The applied amounts total ${formatCents(appliedCents)}, more than the ${formatCents(available)} this payment has unapplied.`,
    }
  }
  return { ok: true, allocations, appliedCents, unappliedCents: available - appliedCents }
}

/**
 * The customer a payment is from, and that customer's items on the project.
 * Pay applications bill the project's client, so they count for that client
 * (or for any customer while the project has no directory client yet).
 * Invoices count for their own customer. Returns null when the customer has
 * nothing billed on the project.
 */
export function receivablesForCustomer<T extends { readonly kind: ReceivableItemKind; readonly customerId: string | null }>(
  items: readonly T[],
  projectClientId: string | null,
  customerId: string | null,
): readonly T[] | null {
  const forCustomer = items.filter((item) =>
    item.kind === "pay_application"
      ? projectClientId === null || projectClientId === customerId
      : customerId !== null && item.customerId === customerId,
  )
  return forCustomer.length > 0 ? forCustomer : null
}

/** The customer a payment from `focus` is credited to: the item's own, else the project's client. */
export function focusCustomerId(
  focus: { readonly kind: ReceivableItemKind; readonly customerId: string | null },
  projectClientId: string | null,
): string | null {
  return focus.kind === "invoice" ? focus.customerId : projectClientId
}

/** An invoice's stored amount paid, amount due and status once `paidCents` is paid in total. */
export function invoicePaidValues(input: {
  readonly totalDollars: number
  readonly paidCents: number
  readonly unpaidStatus: string
}): { readonly amountPaid: number; readonly amountDue: number; readonly status: string } {
  const totalCents = storedDollarsToCents(input.totalDollars)
  const paidCents = Math.max(input.paidCents, 0)
  const state = receivablePaidState(totalCents, paidCents)
  return {
    amountPaid: paidCents / 100,
    amountDue: Math.max(totalCents - paidCents, 0) / 100,
    status: state === "open" ? input.unpaidStatus : state,
  }
}

/** The status an invoice returns to when voiding leaves nothing paid on it. */
export function invoiceUnpaidStatus(sourceSystem: string): string {
  return sourceSystem === "sage" ? "open" : "sent"
}

/** Draft and void invoices cannot take a payment. */
export function invoiceAcceptsPayments(status: string): boolean {
  return status !== "draft" && status !== "void"
}

// ---------------------------------------------------------------------------
// Which draws (pay applications) can take a received payment. A Compass draw
// takes payments once staff approve it for billing (status "billed"). An
// imported draw (a historical pay application read from Sage or Google Drive)
// was billed outside Compass, so it takes payments whenever it carries a
// usable billed amount: its current payment due. Without one it is listed
// with the reason it can't take payments; Compass never guesses an amount.
// ---------------------------------------------------------------------------

/** Draws built and billed in Compass. */
export const COMPASS_DRAW_SOURCE = "compass_contract_budget"

/** Rows that share the draws table but are not draws: each contract budget revision's budget view. */
export const BUDGET_PROJECTION_SOURCE = "compass_contract_budget_projection"

/**
 * Statuses of an imported draw that mean it is not a billed item: a draw still
 * being written, a budget view, or one that was voided or replaced.
 */
export const IMPORTED_DRAW_UNBILLED_STATUSES = ["building", "budget_current", "budget_superseded", "void", "superseded"] as const

type DrawRow = {
  readonly sourceSystem: string
  readonly status: string
  /** Stored dollars (G702 line 8, current payment due). */
  readonly currentPaymentDue: number | null | undefined
}

/** Whether a draw came from Sage, Google Drive or another import rather than being built in Compass. */
export function isImportedDraw(application: Pick<DrawRow, "sourceSystem">): boolean {
  return application.sourceSystem !== COMPASS_DRAW_SOURCE && application.sourceSystem !== BUDGET_PROJECTION_SOURCE
}

/** Where an imported draw came from, for staff ("Imported from Sage"); null for a Compass draw. */
export function importedDrawSourceLabel(sourceSystem: string): string | null {
  if (!isImportedDraw({ sourceSystem })) return null
  if (sourceSystem.startsWith("sage")) return "Imported from Sage"
  if (sourceSystem.startsWith("google_drive")) return "Imported from Drive"
  return "Imported"
}

export type DrawPaymentTarget =
  /** Not a billed draw (a draft, review, budget view or void): not listed with billed items. */
  | { readonly listed: false }
  /** A billed draw: `blocker` says why it can't take payments, or is null when it can. */
  | { readonly listed: true; readonly billedCents: number; readonly blocker: string | null }

/** Whether a draw is listed with the billed items, its billed amount, and whether it can take payments. */
export function drawPaymentTarget(application: DrawRow): DrawPaymentTarget {
  const due = application.currentPaymentDue
  const billedCents = storedDollarsToCents(due)
  if (!isImportedDraw(application)) {
    return application.sourceSystem === COMPASS_DRAW_SOURCE && application.status === "billed"
      ? { listed: true, billedCents, blocker: null }
      : { listed: false }
  }
  if (IMPORTED_DRAW_UNBILLED_STATUSES.some((status) => status === application.status)) return { listed: false }
  if (typeof due !== "number" || !Number.isFinite(due)) {
    return { listed: true, billedCents: 0, blocker: "No current payment due was imported with this draw, so payments can't be applied to it." }
  }
  if (billedCents < 0) {
    return {
      listed: true,
      billedCents,
      blocker: `This draw was imported with a negative current payment due (${formatCents(billedCents)}), so payments can't be applied to it.`,
    }
  }
  if (billedCents === 0) {
    return { listed: true, billedCents, blocker: "This draw was imported with no current payment due, so there is nothing to apply a payment to." }
  }
  return { listed: true, billedCents, blocker: null }
}

// ---------------------------------------------------------------------------
// Settling imported draws. An imported draw's paid status is unknown until
// staff settle it: by recording a payment against it in Compass, or by
// marking it "Paid before Compass" (settled outside Compass, no payment
// details). Owners see no paid or outstanding balance on an imported draw
// until it is settled.
// ---------------------------------------------------------------------------

/** An active "Paid before Compass" mark on an imported draw. */
export type PrepaidMark = {
  readonly markedAt: string
  readonly markedByName: string | null
  readonly note: string | null
}

type SettlementInput = {
  /** Whether the draw is imported (Sage or Drive). */
  readonly imported: boolean
  /** Cents applied by active (not voided) Compass payments. */
  readonly paidCents: number
  /** The active "Paid before Compass" mark (or just whether there is one). */
  readonly prepaid: PrepaidMark | boolean | null
}

/** Whether staff have settled a draw's paid status. Compass draws are always settled. */
export function drawSettled(input: SettlementInput): boolean {
  return !input.imported || input.paidCents > 0 || Boolean(input.prepaid)
}

/** The status staff see on a billed item. */
export type ReceivableStaffStatus = ReceivablePaidState | "prepaid" | "unconfirmed"

export function receivableStaffStatus(input: SettlementInput & { readonly paidState: ReceivablePaidState }): ReceivableStaffStatus {
  if (input.prepaid) return "prepaid"
  if (!drawSettled(input)) return "unconfirmed"
  return input.paidState
}

/** Why staff may not mark a draw "Paid before Compass", or null when they may. */
export function prepaidMarkBlocker(input: SettlementInput): string | null {
  if (!input.imported) return "Only an imported draw can be marked paid before Compass."
  if (input.prepaid) return "This draw is already marked paid before Compass."
  if (input.paidCents > 0) return "Payments are already applied to this draw in Compass, so it can't be marked paid before Compass."
  return null
}

/** Why staff may not undo a "Paid before Compass" mark, or null when they may. */
export function prepaidUndoBlocker(input: SettlementInput): string | null {
  if (!input.prepaid) return "This draw is not marked paid before Compass."
  if (input.paidCents > 0) return "Payments are applied to this draw in Compass. Void them before undoing the mark."
  return null
}

export const PREPAID_NOTE_MAX = 500

/** The optional note on a "Paid before Compass" mark, as stored. */
export function parsePrepaidNote(raw: string): string | null {
  return raw.trim().slice(0, PREPAID_NOTE_MAX) || null
}

/** The reason for undoing a "Paid before Compass" mark, or an error when it is blank. */
export function parsePrepaidUndoReason(raw: string): { readonly ok: true; readonly reason: string } | { readonly ok: false; readonly error: string } {
  const reason = raw.trim().slice(0, VOID_REASON_MAX)
  return reason ? { ok: true, reason } : { ok: false, error: "Say why the mark is being undone." }
}

/**
 * For each item, the label of a billed item of the other kind (draw vs
 * invoice) carrying the same Sage invoice number: the two may be the same
 * billing, so staff should apply a payment to only one. Keyed "kind:id".
 */
export function sharedSageInvoiceLinks(
  items: readonly { readonly kind: ReceivableItemKind; readonly id: string; readonly label: string; readonly sageInvoiceNumber: string | null }[],
): ReadonlyMap<string, string> {
  const byNumber = new Map<string, { kind: ReceivableItemKind; label: string }[]>()
  for (const item of items) {
    const number = item.sageInvoiceNumber?.trim().toUpperCase()
    if (!number) continue
    byNumber.set(number, [...(byNumber.get(number) ?? []), { kind: item.kind, label: item.label }])
  }
  const links = new Map<string, string>()
  for (const item of items) {
    const number = item.sageInvoiceNumber?.trim().toUpperCase()
    if (!number) continue
    const other = byNumber.get(number)?.find((entry) => entry.kind !== item.kind)
    if (other) links.set(`${item.kind}:${item.id}`, other.label)
  }
  return links
}

/** Why staff may not void a payment in Compass, or null when they may. */
export function paymentVoidBlocker(payment: { readonly sourceSystem: string; readonly voidedAt: string | null }): string | null {
  if (payment.voidedAt) return "This payment is already void."
  if (payment.sourceSystem !== "compass" && payment.sourceSystem !== "manual") {
    return "This payment came from Square through Sage. Refund or reverse it there."
  }
  return null
}

export const VOID_REASON_MAX = 500

/** The void reason as stored, or an error when it is blank. */
export function parseVoidReason(raw: string): { readonly ok: true; readonly reason: string } | { readonly ok: false; readonly error: string } {
  const reason = raw.trim().slice(0, VOID_REASON_MAX)
  return reason ? { ok: true, reason } : { ok: false, error: "Say why the payment is being voided." }
}

/**
 * An invoice's paid cents after releasing `releasedCents` of a voided payment.
 * Never below zero, so a manually typed amount paid can't go negative.
 */
export function paidCentsAfterRelease(paidCents: number, releasedCents: number): number {
  return Math.max(paidCents - releasedCents, 0)
}
