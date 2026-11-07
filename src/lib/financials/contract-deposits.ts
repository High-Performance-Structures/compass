/**
 * Deposits on contracts applied to pay applications. G702 amounts are dollars
 * (two decimals); deposit records are cents.
 */

import { formatCents } from "@/lib/format"

export type DepositApplicationMode = "auto" | "manual"

function dollars(value: number): number {
  return Math.round(value * 100) / 100
}

/** What this draw can take: earned less retainage not yet certified. */
export function drawAmountBeforeDeposit(input: {
  readonly totalEarnedLessRetainage: number
  readonly previousCertificates: number
}): number {
  return Math.max(0, dollars(input.totalEarnedLessRetainage - input.previousCertificates))
}

/**
 * Deposit applied to a draw. Auto applies as much of the available balance as
 * the draw can take; manual keeps the requested amount within both limits.
 */
export function depositAppliedToDraw(input: {
  readonly mode: DepositApplicationMode
  readonly requested: number
  readonly availableDeposit: number
  readonly drawBeforeDeposit: number
}): number {
  const ceiling = Math.max(0, Math.min(dollars(input.availableDeposit), input.drawBeforeDeposit))
  if (input.mode === "auto") return ceiling
  return Math.min(Math.max(0, dollars(input.requested)), ceiling)
}

/** G702 line 8: current payment due after the deposit applied to this draw. */
export function currentPaymentDueAfterDeposit(input: {
  readonly totalEarnedLessRetainage: number
  readonly previousCertificates: number
  readonly depositApplied: number
}): number {
  return dollars(input.totalEarnedLessRetainage - input.previousCertificates - input.depositApplied)
}

/** Deposit received and not yet applied to any pay application, in dollars. */
export function unappliedDeposit(input: {
  readonly receivedCents: number
  readonly appliedDollars: number
}): number {
  return Math.max(0, dollars(input.receivedCents / 100 - input.appliedDollars))
}

// ---------------------------------------------------------------------------
// Deposits already applied on imported draws. A deposit billed before Compass
// was in use is often applied on a historical (imported) draw, whose deposit
// amount was not imported. Staff record it on that draw, so the available
// balance counts it and the next Compass draft does not apply it again.
// ---------------------------------------------------------------------------

/**
 * How a pay application's deposit_applied was set. auto/manual: on a Compass
 * draft (see depositAppliedToDraw). recorded: staff recorded a deposit that
 * was already applied on an imported draw billed outside Compass.
 */
export type DepositAppliedMode = DepositApplicationMode | "recorded"

/** Pay application statuses whose deposit_applied does not count against the deposit received. */
export const DEPOSIT_UNCOUNTED_APPLICATION_STATUSES = ["budget_current", "budget_superseded", "void", "building"] as const

/** Compass draw statuses that are still recalculated, so nothing depends on them yet. */
export const UNSUBMITTED_DRAW_STATUSES = ["draft", "building", "void"] as const

export const IMPORTED_DEPOSIT_NOTE_MAX = 500
export const IMPORTED_DEPOSIT_REASON_MAX = 500

/**
 * Received deposit not yet applied on an imported draw, a submitted or billed
 * draw, or a draft whose amount staff set by hand. Drafts that apply the
 * deposit automatically recalculate afterwards, so they do not count.
 */
export function recordableDepositCents(input: {
  readonly receivedCents: number
  readonly lockedAppliedDollars: number
}): number {
  return Math.max(0, input.receivedCents - Math.round(input.lockedAppliedDollars * 100))
}

/** The amount to record on an imported draw, in cents, or why it can't be recorded. */
export function importedDrawDepositAmount(input: {
  readonly amountDollars: number | null
  readonly recordableCents: number
}): { readonly ok: true; readonly cents: number } | { readonly ok: false; readonly error: string } {
  const { amountDollars, recordableCents } = input
  if (amountDollars === null || !Number.isFinite(amountDollars) || amountDollars <= 0) {
    return { ok: false, error: "Enter the deposit applied on the draw." }
  }
  const cents = Math.round(amountDollars * 100)
  if (recordableCents <= 0) return { ok: false, error: "No received deposit is left to apply. Record the deposit as received first." }
  if (cents > recordableCents) {
    return { ok: false, error: `Only ${formatCents(recordableCents)} of received deposit is not yet applied.` }
  }
  return { ok: true, cents }
}

/** Why a deposit recorded on an imported draw can't be undone, or null when it can. */
export function importedDrawDepositUndoBlocker(input: {
  readonly mode: string
  /** Compass pay applications past draft (submitted, in review or billed). */
  readonly submittedCompassDraws: number
}): string | null {
  if (input.mode !== "recorded") return "No deposit is recorded on this draw."
  if (input.submittedCompassDraws > 0) {
    return "A Compass pay application past draft already counts this deposit as applied, so it can't be removed."
  }
  return null
}

/** The reason for removing a recorded deposit, or an error when it is blank. */
export function parseImportedDepositUndoReason(
  raw: string
): { readonly ok: true; readonly reason: string } | { readonly ok: false; readonly error: string } {
  const reason = raw.trim().slice(0, IMPORTED_DEPOSIT_REASON_MAX)
  return reason ? { ok: true, reason } : { ok: false, error: "Say why the deposit is being removed from this draw." }
}
