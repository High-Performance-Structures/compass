/*
 * Matching billed records that are the same bill: imported cutover copies in
 * the financial workflow list, duplicate received-payment items, and the
 * owner's pay application history. Pure: no database access.
 */
import { isListValue } from "@/lib/shared/statuses"

import { BUDGET_PROJECTION_SOURCE, COMPASS_DRAW_SOURCE, storedDollarsToCents } from "./rules"

// ---------------------------------------------------------------------------
// Imported bills shown once. A cutover from another system (Buildertrend,
// Drive, Sage) promoted owner invoices and pay requests into the project's
// financial workflow list, and the same bill is often also an invoice or a
// pay application listed with received payments, sometimes under another
// source system (a "buildertrend_import" pay request that is a Compass
// invoice). Two records are the same bill only when their amounts agree to
// the cent and a source id or their number matches.
// ---------------------------------------------------------------------------

/** Workflow rows promoted from another system; Compass's own workflow items are never matched. */
const IMPORTED_WORKFLOW_SOURCES = ["buildertrend", "buildertrend_import", "google_drive_g702_g703", "sage"] as const

type BillKind = "invoice" | "draw"

/** A billed record: its kind, ids (row id, source record id), number and amount in cents. */
export type BillRef = {
  readonly kind: BillKind
  readonly ids: readonly (string | null)[]
  readonly number: string | null
  readonly cents: number
  /**
   * Other amounts the same bill is known by: a draw's total earned less
   * retainage, which some imported G702 copies carry instead of the amount due.
   */
  readonly otherCents?: readonly number[]
  /**
   * An invoice that came over with the cutover (imported, or recorded before
   * Compass built its own invoices) rather than one staff built in Compass.
   */
  readonly importedRecord?: boolean
}

function amountsAgree(left: BillRef, right: BillRef): boolean {
  return left.cents === right.cents || (left.otherCents ?? []).includes(right.cents) || (right.otherCents ?? []).includes(left.cents)
}

/**
 * The prefix a job's own bill numbers start with: its number without the
 * last part ("O-170" for job O-170-2684). Null when the job has no number.
 */
function jobBillPrefix(projectNumber: string | null): string | null {
  const trimmed = projectNumber?.trim() ?? ""
  const cut = trimmed.lastIndexOf("-")
  return cut > 0 ? trimmed.slice(0, cut).toLowerCase() : null
}

/** A number that names one bill on this job: it starts with the job's prefix ("O-170-003"), unlike "3" or "INV-1". */
function isJobSpecificNumber(value: string, prefix: string | null): boolean {
  const key = value.trim().toLowerCase()
  return prefix !== null && key.startsWith(`${prefix}-`) && key.length > prefix.length + 1
}

function invoiceNumberKey(value: string): string {
  return value.trim().toLowerCase()
}

/** A pay application's sequence: its last group of digits ("PA-009" and "9" are 9; "H-329-9607-01" is 1). */
export function billSequence(value: string): string | null {
  // A labelled sequence first ("PAYAPP-003", "PR5-31Aug26"), then a trailing "-<n>",
  // then the last group of digits ("Contract Budget R2", "9").
  const digits =
    /PAYAPP-?0*(\d+)/i.exec(value)?.[1] ??
    /(?:^|[^a-z])PR-?0*(\d+)/i.exec(value)?.[1] ??
    /-0*(\d+)\s*$/.exec(value)?.[1] ??
    /(\d+)\D*$/.exec(value)?.[1]
  return digits ? String(Number(digits)) : null
}

/** Whether two billed records are the same bill (same cents, and a shared id or a matching number). */
function sameBill(left: BillRef, right: BillRef): boolean {
  if (!amountsAgree(left, right)) return false
  const ids = new Set(left.ids.flatMap((id) => (id?.trim() ? [id.trim()] : [])))
  if (right.ids.some((id) => Boolean(id?.trim()) && ids.has(id?.trim() ?? ""))) return true
  if (!left.number?.trim() || !right.number?.trim()) return false
  if (invoiceNumberKey(left.number) === invoiceNumberKey(right.number)) return true
  // A draw is numbered by sequence; an invoice number ends with it (H-329-9607-01 is draw 1).
  if (left.kind === "invoice" && right.kind === "invoice") return false
  const sequence = billSequence(left.number)
  return sequence !== null && sequence === billSequence(right.number)
}

type WorkflowRow = {
  readonly sourceSystem: string
  readonly sourceRecordType: string
  readonly sourceRecordId: string | null
  readonly sourceRecordNumber: string | null
  readonly amount: number | null
}

/** Which listed bills an imported workflow row can be: invoices for an invoice, draws for a pay request. */
function workflowCandidates(row: WorkflowRow): readonly BillKind[] {
  if (!isListValue(IMPORTED_WORKFLOW_SOURCES, row.sourceSystem)) return []
  if (row.sourceRecordType === "owner_invoice") return ["invoice"]
  if (row.sourceRecordType !== "owner_pay_application") return []
  // Pay requests imported from Buildertrend were billed as Compass invoices on some jobs.
  return row.sourceSystem === "buildertrend_import" ? ["draw", "invoice"] : ["draw"]
}

/**
 * The listed bill an imported workflow invoice or pay request is a copy of,
 * or null. The workflow list leaves the copy out and says where it is.
 */
export type ListedBillMatch<T> = {
  readonly bill: T
  readonly recordedCents: number
  /** "amount": same amount (or id); "total_earned": the copy carries the draw's total earned less retainage; "number": the same job-specific invoice number, another amount. */
  readonly how: "amount" | "total_earned" | "number"
}

export function listedBillFor<T extends BillRef>(
  row: WorkflowRow,
  listed: readonly T[],
  job: {
    /** The job's number, for its bill-number prefix. */
    readonly projectNumber: string | null
    /** How many imported workflow invoices on the job carry this row's number. */
    readonly sameNumberCopies: number
  }
): ListedBillMatch<T> | null {
  const kinds = workflowCandidates(row)
  if (kinds.length === 0 || row.amount === null) return null
  const cents = storedDollarsToCents(row.amount)
  const same = listed.find((bill) =>
    kinds.includes(bill.kind) &&
    sameBill(bill, { kind: bill.kind, ids: [row.sourceRecordId], number: row.sourceRecordNumber, cents })
  )
  if (same) return { bill: same, recordedCents: cents, how: same.cents === cents ? "amount" : "total_earned" }
  // An imported owner invoice whose number names one bill on the job (O-170-003) is
  // that invoice even when the import recorded another stage of it; the difference
  // is shown, not hidden. Only between records that both came over with the
  // cutover, for a positive amount, and when no other imported copy has the number.
  const number = row.sourceRecordNumber?.trim() ?? ""
  if (row.sourceRecordType !== "owner_invoice" || cents <= 0 || job.sameNumberCopies !== 1) return null
  if (!isJobSpecificNumber(number, jobBillPrefix(job.projectNumber))) return null
  const byNumber = listed.filter(
    (bill) => bill.kind === "invoice" && bill.importedRecord === true && bill.cents > 0 && bill.number !== null && invoiceNumberKey(bill.number) === invoiceNumberKey(number)
  )
  const [only] = byNumber
  return only && byNumber.length === 1 ? { bill: only, recordedCents: cents, how: "number" } : null
}

/**
 * The owner's pay applications with each bill once: rows that are the same
 * bill (an imported copy of a draw built in Compass or synced from Sage, same
 * sequence and amount) keep the live record (Compass, then Sage, then the
 * import). Order is kept.
 */
export function ownerPayApplicationsOnce<T extends { readonly sourceSystem: string; readonly applicationNumber: string; readonly currentPaymentDue: number }>(
  rows: readonly T[],
): T[] {
  const rank = (row: T): number => (row.sourceSystem === COMPASS_DRAW_SOURCE ? 0 : row.sourceSystem.startsWith("sage") ? 1 : 2)
  const ref = (row: T): BillRef => ({ kind: "draw", ids: [], number: row.applicationNumber, cents: storedDollarsToCents(row.currentPaymentDue) })
  const kept: T[] = []
  for (const row of rows) {
    const same = kept.findIndex((other) => other.sourceSystem !== BUDGET_PROJECTION_SOURCE && row.sourceSystem !== BUDGET_PROJECTION_SOURCE && sameBill(ref(other), ref(row)))
    if (same < 0) kept.push(row)
    else if (rank(row) < rank(kept[same] ?? row)) kept[same] = row
  }
  const keep = new Set(kept)
  return rows.filter((row) => keep.has(row))
}

/** Records billed in Compass or Sage; never hidden as a copy of another bill. */
function isLiveBillSource(sourceSystem: string): boolean {
  return sourceSystem === COMPASS_DRAW_SOURCE || sourceSystem === "compass" || sourceSystem.startsWith("sage")
}

type ListedReceivable = {
  readonly bill: BillRef
  readonly label: string
  readonly sourceSystem: string
  readonly paidCents: number
  readonly prepaid: unknown
}

/**
 * Billed items with an imported copy of the same bill left out (a
 * Buildertrend invoice and a Drive G702 for one draw, say). The copy kept is
 * the one with payments, else the live (Compass or Sage) record, else the
 * draw; an item with payments, or billed in Compass or Sage, is never left
 * out. `sameBillAs` names the copy left out, for the kept row's note.
 */
export function receivablesOncePerBill<T extends ListedReceivable>(rows: readonly T[]): { readonly row: T; readonly sameBillAs: string | null }[] {
  const keepFirst = (row: T): number =>
    (row.paidCents > 0 || row.prepaid ? 0 : 4) + (isLiveBillSource(row.sourceSystem) ? 0 : 2) + (row.bill.kind === "draw" ? 0 : 1)
  const removable = (row: T): boolean => row.paidCents === 0 && !row.prepaid && !isLiveBillSource(row.sourceSystem)
  const left = new Map<T, string>()
  const sameBillAs = new Map<T, string>()
  const ordered = [...rows].sort((a, b) => keepFirst(a) - keepFirst(b))
  for (const [index, kept] of ordered.entries()) {
    if (left.has(kept)) continue
    for (const other of ordered.slice(index + 1)) {
      if (left.has(other) || !removable(other) || !sameBill(kept.bill, other.bill)) continue
      left.set(other, kept.label)
      sameBillAs.set(kept, other.label)
    }
  }
  return rows.filter((row) => !left.has(row)).map((row) => ({ row, sameBillAs: sameBillAs.get(row) ?? null }))
}

/** Statuses owners never see as billing: a draw still being written, a replaced budget revision, a voided or replaced import. */
export const OWNER_HIDDEN_APPLICATION_STATUSES = ["building", "budget_superseded", "void", "superseded"] as const

/**
 * The owner's pay application history: no contract budget (stored like a pay
 * application but not one), nothing in OWNER_HIDDEN_APPLICATION_STATUSES, and
 * each bill once (ownerPayApplicationsOnce).
 */
export function ownerPayApplicationHistory<
  T extends { readonly sourceSystem: string; readonly status: string; readonly applicationNumber: string; readonly currentPaymentDue: number },
>(rows: readonly T[]): T[] {
  return ownerPayApplicationsOnce(rows.filter((row) => !isListValue(OWNER_HIDDEN_APPLICATION_STATUSES, row.status))).filter(
    (row) => row.sourceSystem !== BUDGET_PROJECTION_SOURCE
  )
}

