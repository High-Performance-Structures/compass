/**
 * Deposits on contracts applied to pay applications. G702 amounts are dollars
 * (two decimals); deposit records are cents.
 */

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
