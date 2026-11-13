import { and, isNull, lt, or, type SQL } from "drizzle-orm"

import { invoices } from "@/db/schema-netsuite"

/*
 * The simple invoice email send claim (invoices.email_claimed_at / _by and
 * email_unconfirmed_at, migration 0322), shared by the store's reopen and
 * delete fences, the claim itself (./invoice-guards.ts) and the send panel.
 * emailed_at means delivered; the claim means a send is in flight;
 * email_unconfirmed_at means a send may have gone out (outcome unknown).
 */

/** How long a send claim holds before another request may take it (the request that held it died). */
export const EMAIL_CLAIM_LEASE_MS = 10 * 60 * 1000

function msBefore(now: string, ms: number): string {
  return new Date(Date.parse(now) - ms).toISOString()
}

/** No send of the invoice is in flight (a claim older than the lease is dead). */
export function noLiveEmailClaim(now: string): SQL | undefined {
  return or(isNull(invoices.emailClaimedAt), lt(invoices.emailClaimedAt, msBefore(now, EMAIL_CLAIM_LEASE_MS)))
}

/** Never emailed, not maybe-emailed, and no send in flight: the invoice may still be reopened or deleted. */
export function invoiceEmailNotOut(now: string): SQL | undefined {
  return and(isNull(invoices.emailedAt), isNull(invoices.emailUnconfirmedAt), noLiveEmailClaim(now))
}

/** Why another email of the invoice can't start now; null when it can. */
export type InvoiceEmailBlock =
  | { readonly kind: "sending" }
  | { readonly kind: "recently_sent"; readonly minutesAgo: number; readonly minutesLeft: number }

export function invoiceEmailBlock(input: {
  readonly emailedAt: string | null
  readonly emailClaimedAt: string | null
  readonly now: string
  readonly windowMs: number
}): InvoiceEmailBlock | null {
  if (input.emailClaimedAt !== null && input.emailClaimedAt >= msBefore(input.now, EMAIL_CLAIM_LEASE_MS)) return { kind: "sending" }
  if (input.emailedAt === null || input.emailedAt < msBefore(input.now, input.windowMs)) return null
  const agoMs = Math.max(Date.parse(input.now) - Date.parse(input.emailedAt), 0)
  return { kind: "recently_sent", minutesAgo: Math.floor(agoMs / 60_000), minutesLeft: Math.max(Math.ceil((input.windowMs - agoMs) / 60_000), 1) }
}

/** The staff message for a block. */
export function invoiceEmailBlockMessage(block: InvoiceEmailBlock): string {
  if (block.kind === "sending") return "This invoice is being emailed right now. Wait for that send to finish."
  const ago = block.minutesAgo < 1 ? "less than a minute ago" : `${block.minutesAgo} minute${block.minutesAgo === 1 ? "" : "s"} ago`
  return `This invoice was emailed ${ago}. You can send it again in ${block.minutesLeft} minute${block.minutesLeft === 1 ? "" : "s"}.`
}
