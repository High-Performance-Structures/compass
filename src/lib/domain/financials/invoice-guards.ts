import { and, eq, isNotNull, isNull, lt, notInArray, or, sql, type SQL } from "drizzle-orm"

import { invoices, type NewInvoice } from "@/db/schema-netsuite"
import { invoiceEmailBlock, noLiveEmailClaim, type InvoiceEmailBlock } from "@/lib/domain/financials/invoice-email-fence"
import { INVOICE_CLOSED_TO_PAYMENTS } from "@/lib/domain/financials/invoice-machines"
import { deleteInvoiceRowsWhere, simpleInvoiceUpdateStatement, updateInvoiceRowsWhere } from "@/lib/domain/financials/store"
import type { Db } from "@/lib/server/action-context"

/*
 * Two owner-approved invoice guards (2026-11-12). Each write goes through
 * ./store.ts (the invoices writer) with its fence in the write's WHERE, never
 * in a read before it, so a concurrent request can't slip past.
 *
 * 1. Older invoices (invoice_kind NULL) edited in the Financials editor: once
 *    a recorded payment is applied (an unreleased invoice_payment_allocations
 *    row), amount paid and status come from the payments, the total can't drop
 *    below them, and a new total recomputes amount paid, amount due and status
 *    the way refreshInvoicePaidStatusStatement does. Any allocation row (even
 *    released) keeps the invoice on its job and undeletable.
 *
 * 2. Emailing a simple invoice: a request claims the send (email_claimed_at /
 *    _by, a lease of EMAIL_CLAIM_LEASE_MS) before making the PDF or sending,
 *    so of a double click or two staff only one sends; another send is also
 *    refused while emailed_at (delivered) is inside the company's re-send
 *    window (Settings > Workflows > Simple invoices). Right before the
 *    hand-off to the mail provider the claim is renewed and the invoice is
 *    marked email_unconfirmed_at ("may have gone out") in one write. A
 *    definite failure clears both; an unknown outcome frees the claim but
 *    keeps the marker, which blocks a re-send, reopen and delete until staff
 *    confirm it didn't go out; delivery stamps emailed_at and clears both.
 */

/** The invoice has a payment allocation that still counts (voided payments release theirs). */
function invoiceHasAppliedPayments(invoiceId: string): SQL {
  // A bound id, not a column: inside the subquery an unqualified "id" would be the allocation's.
  return sql`EXISTS (SELECT 1 FROM invoice_payment_allocations WHERE invoice_id = ${invoiceId} AND released_at IS NULL)`
}

/** Cents of payments that still count on the invoice. */
function appliedCents(invoiceId: string): SQL {
  return sql`COALESCE((SELECT SUM(allocation_cents) FROM invoice_payment_allocations WHERE invoice_id = ${invoiceId} AND released_at IS NULL), 0)`
}

/** Any allocation row, released ones included: they keep pointing at the invoice's project (foreign key). */
function invoiceHasPaymentHistory(invoiceId: string): SQL {
  return sql`EXISTS (SELECT 1 FROM invoice_payment_allocations WHERE invoice_id = ${invoiceId})`
}

export type LegacyInvoiceUpdate = "updated" | "paid_by_payments" | "total_below_paid" | "has_payment_history" | "not_found"

/**
 * Saves an older invoice from the Financials editor. With payments applied:
 * status and amount paid can't change (values equal to the stored ones pass;
 * the editor re-sends what it loaded), the total can't drop below what was
 * paid, and a new total recomputes amount due and the paid status in the
 * same write. An invoice with any payment history can't move to another
 * project. Every fence is in the UPDATE, so a payment applied after the
 * editor's read still wins.
 */
export async function updateLegacyInvoiceRow(
  db: Db,
  key: { readonly id: string; readonly organizationId: string },
  values: Partial<NewInvoice>,
): Promise<LegacyInvoiceUpdate> {
  const scope = and(
    eq(invoices.id, key.id),
    isNull(invoices.invoiceKind),
    sql`${invoices.projectId} IN (SELECT id FROM projects WHERE organization_id = ${key.organizationId})`,
  )
  const applied = invoiceHasAppliedPayments(key.id)
  const touchesPaidFields = values.status !== undefined || values.amountPaid !== undefined
  const paidFence = touchesPaidFields
    ? or(sql`NOT ${applied}`, and(
      values.status === undefined ? undefined : eq(invoices.status, values.status),
      values.amountPaid === undefined ? undefined : eq(invoices.amountPaid, values.amountPaid),
    ))
    : undefined
  // Only with payments applied: a credit or adjustment invoice with none may have a negative total.
  const totalFence = values.total === undefined ? undefined : or(sql`NOT ${applied}`, sql`CAST(ROUND(${values.total} * 100) AS INTEGER) >= ${appliedCents(key.id)}`)
  const projectFence = values.projectId === undefined
    ? undefined
    : or(sql`${invoices.projectId} IS ${values.projectId}`, sql`NOT ${invoiceHasPaymentHistory(key.id)}`)
  // A new total on an invoice with payments applied: amount paid, amount due and
  // status follow the payments exactly as refreshInvoicePaidStatusStatement computes them.
  const paidDollars = sql`(${appliedCents(key.id)} / 100.0)`
  const paidByPayments = and(applied, notInArray(invoices.status, [...INVOICE_CLOSED_TO_PAYMENTS]))
  const recomputed = values.total === undefined ? {} : {
    amountPaid: sql`CASE WHEN ${applied} THEN MIN(${values.total}, ${paidDollars}) ELSE ${values.amountPaid ?? invoices.amountPaid} END`,
    amountDue: sql`CASE WHEN ${applied} THEN (CASE WHEN ${invoices.status} = 'void' THEN 0 ELSE MAX(${values.total} - ${paidDollars}, 0) END) ELSE ${values.amountDue ?? sql`${values.total} - ${invoices.amountPaid}`} END`,
    status: sql`CASE WHEN ${paidByPayments} THEN (CASE WHEN ${appliedCents(key.id)} >= CAST(ROUND(${values.total} * 100) AS INTEGER) THEN 'paid' ELSE 'partially_paid' END) ELSE ${values.status ?? invoices.status} END`,
  }
  const updated = await updateInvoiceRowsWhere(db, and(scope, paidFence, totalFence, projectFence), { ...values, ...recomputed })
  if (updated.length === 1) return "updated"
  // Which fence refused (read after the write; the write was the decision).
  const row = await db.select({
    totalCents: sql<number>`CAST(ROUND(${values.total ?? 0} * 100) AS INTEGER)`,
    paidCents: sql<number>`${appliedCents(key.id)}`,
    history: sql<number>`${invoiceHasPaymentHistory(key.id)}`,
    projectId: invoices.projectId,
  }).from(invoices).where(scope).get()
  if (!row) return "not_found"
  if (values.projectId !== undefined && values.projectId !== row.projectId && row.history) return "has_payment_history"
  if (values.total !== undefined && row.paidCents > 0 && row.totalCents < row.paidCents) return "total_below_paid"
  return "paid_by_payments"
}

/** Deletes an older invoice that no payment was ever applied to (allocation rows keep it as history). */
export async function deleteLegacyInvoiceRow(db: Db, key: { readonly id: string; readonly organizationId: string }): Promise<"deleted" | "has_payment_history" | "not_found"> {
  const scope = and(eq(invoices.id, key.id), isNull(invoices.invoiceKind), sql`${invoices.projectId} IN (SELECT id FROM projects WHERE organization_id = ${key.organizationId})`)
  const deleted = await deleteInvoiceRowsWhere(db, and(scope, sql`NOT ${invoiceHasPaymentHistory(key.id)}`))
  if (deleted.length === 1) return "deleted"
  return (await db.select({ id: invoices.id }).from(invoices).where(scope).get()) ? "has_payment_history" : "not_found"
}

type SimpleInvoiceKey = { readonly invoiceId: string; readonly organizationId: string; readonly projectId: string }

export type InvoiceEmailClaim = { readonly claimedAt: string; readonly actorId: string }

export type InvoiceEmailRefusal =
  | InvoiceEmailBlock
  | { readonly kind: "unconfirmed" }
  | { readonly kind: "draft" }
  | { readonly kind: "void" }
  | { readonly kind: "missing" }

type ClaimResult =
  | { readonly ok: true; readonly claim: InvoiceEmailClaim }
  | { readonly ok: false; readonly reason: InvoiceEmailRefusal }

/** Delivery statuses (lib/email/compass-email.ts) that mean the message definitely did not go out; anything else but "sent" may have. */
const NOT_SENT_STATUSES: readonly string[] = ["failed", "pending_provider", "rate_limited"]

export function emailDefinitelyNotSent(status: string): boolean {
  return NOT_SENT_STATUSES.includes(status)
}

function simpleInvoice(key: SimpleInvoiceKey): SQL | undefined {
  return and(eq(invoices.id, key.invoiceId), eq(invoices.organizationId, key.organizationId), eq(invoices.projectId, key.projectId), isNotNull(invoices.invoiceKind))
}

function ownClaim(claim: InvoiceEmailClaim): SQL | undefined {
  return and(eq(invoices.emailClaimedAt, claim.claimedAt), eq(invoices.emailClaimedBy, claim.actorId))
}

/** Clears a column only where this request's own claim still holds (never another send's). */
function ifOwnClaim(claim: InvoiceEmailClaim, column: typeof invoices.emailClaimedAt | typeof invoices.emailClaimedBy): SQL {
  return sql`CASE WHEN ${ownClaim(claim)} THEN NULL ELSE ${column} END`
}

/** Clears the "may have gone out" marker only where this request wrote it (at its hand-off). */
function ifOwnMarker(claim: InvoiceEmailClaim): SQL {
  return sql`CASE WHEN ${invoices.emailUnconfirmedAt} = ${claim.claimedAt} THEN NULL ELSE ${invoices.emailUnconfirmedAt} END`
}

async function refusal(db: Db, key: SimpleInvoiceKey & { readonly now: string; readonly windowMs: number }): Promise<ClaimResult> {
  const row = await db.select({ status: invoices.status, emailedAt: invoices.emailedAt, emailClaimedAt: invoices.emailClaimedAt, emailUnconfirmedAt: invoices.emailUnconfirmedAt })
    .from(invoices).where(simpleInvoice(key)).get()
  if (!row) return { ok: false, reason: { kind: "missing" } }
  if (row.status === "draft") return { ok: false, reason: { kind: "draft" } }
  if (row.status === "void") return { ok: false, reason: { kind: "void" } }
  if (row.emailUnconfirmedAt !== null) return { ok: false, reason: { kind: "unconfirmed" } }
  // A claim that just finished leaves nothing to name; treat it as in flight.
  return { ok: false, reason: invoiceEmailBlock({ ...row, now: key.now, windowMs: key.windowMs }) ?? { kind: "sending" } }
}

/**
 * Claims the send: refused while another send is in flight (a live lease),
 * while an earlier send may have gone out (unconfirmed, until staff say it
 * didn't), when the invoice was delivered within `windowMs`, and for a draft
 * or void invoice. The condition is in the write, so of concurrent requests
 * one wins.
 */
export async function claimSimpleInvoiceEmail(db: Db, key: SimpleInvoiceKey & { readonly actorId: string; readonly now: string; readonly windowMs: number }): Promise<ClaimResult> {
  const windowStart = new Date(Date.parse(key.now) - key.windowMs).toISOString()
  const claimed = await simpleInvoiceUpdateStatement(db, and(
    simpleInvoice(key),
    notInArray(invoices.status, [...INVOICE_CLOSED_TO_PAYMENTS]),
    noLiveEmailClaim(key.now),
    isNull(invoices.emailUnconfirmedAt),
    or(isNull(invoices.emailedAt), lt(invoices.emailedAt, windowStart)),
  ), { emailClaimedAt: key.now, emailClaimedBy: key.actorId }).returning({ id: invoices.id })
  if (claimed.length !== 1) return refusal(db, key)
  return { ok: true, claim: { claimedAt: key.now, actorId: key.actorId } }
}

/**
 * The hand-off: right before the provider gets the message, renews this
 * request's claim and writes the "may have gone out" marker in the same
 * UPDATE, so an evicted Worker or a lost write afterwards leaves the invoice
 * unconfirmed, never "not emailed". Null (do not send) when the claim isn't
 * this request's any more or the invoice went to draft or void meanwhile.
 */
export async function renewSimpleInvoiceEmail(db: Db, key: SimpleInvoiceKey & { readonly claim: InvoiceEmailClaim; readonly now: string }): Promise<InvoiceEmailClaim | null> {
  const renewed = await updateInvoiceRowsWhere(db, and(simpleInvoice(key), ownClaim(key.claim), notInArray(invoices.status, [...INVOICE_CLOSED_TO_PAYMENTS])), {
    emailClaimedAt: key.now,
    emailUnconfirmedAt: sql`COALESCE(${invoices.emailUnconfirmedAt}, ${key.now})`,
  })
  return renewed.length === 1 ? { claimedAt: key.now, actorId: key.claim.actorId } : null
}

/**
 * Frees this request's claim (never another send's). "not_sent": the email
 * definitely did not go out, so the marker this request wrote is cleared too
 * and staff can retry at once. "unknown": it may have gone out, so the marker
 * stays and blocks a re-send, reopen and delete until staff confirm.
 */
export async function releaseSimpleInvoiceEmail(db: Db, key: SimpleInvoiceKey & { readonly claim: InvoiceEmailClaim; readonly outcome: "not_sent" | "unknown" }): Promise<boolean> {
  const released = await updateInvoiceRowsWhere(db, and(simpleInvoice(key), ownClaim(key.claim)), {
    emailClaimedAt: null,
    emailClaimedBy: null,
    ...(key.outcome === "not_sent" ? { emailUnconfirmedAt: ifOwnMarker(key.claim) } : {}),
  })
  return released.length === 1
}

/**
 * Staff checked the sent mail: the unconfirmed send didn't go out. Frees a
 * re-send, reopen and delete. Refused while a send is in flight (its claim is
 * never wiped).
 */
export async function clearSimpleInvoiceEmailUnconfirmed(db: Db, key: SimpleInvoiceKey & { readonly now: string }): Promise<"cleared" | "sending" | "none"> {
  const cleared = await updateInvoiceRowsWhere(db, and(simpleInvoice(key), isNotNull(invoices.emailUnconfirmedAt), noLiveEmailClaim(key.now)), {
    emailUnconfirmedAt: null, emailClaimedAt: null, emailClaimedBy: null,
  })
  if (cleared.length === 1) return "cleared"
  const row = await db.select({ unconfirmed: invoices.emailUnconfirmedAt }).from(invoices).where(simpleInvoice(key)).get()
  return row?.unconfirmed ? "sending" : "none"
}

/** The email went out: one UPDATE stamps it delivered, clears this request's marker and frees its own claim (never a newer one). */
export async function completeSimpleInvoiceEmail(db: Db, key: SimpleInvoiceKey & { readonly claim: InvoiceEmailClaim; readonly now: string }): Promise<void> {
  await updateInvoiceRowsWhere(db, simpleInvoice(key), {
    emailedAt: key.now,
    emailedByUserId: key.claim.actorId,
    emailUnconfirmedAt: ifOwnMarker(key.claim),
    emailClaimedAt: ifOwnClaim(key.claim, invoices.emailClaimedAt),
    emailClaimedBy: ifOwnClaim(key.claim, invoices.emailClaimedBy),
    updatedAt: key.now,
  })
}
