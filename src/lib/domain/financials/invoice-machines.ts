/**
 * Status machines for money coming in on simple invoices (issue #1329, money
 * sweep). Pure: no database access. ./store.ts applies each event as a
 * compare-and-set write on the event's source states, so two staff (or staff
 * and the Square webhook) acting on one invoice at once end with exactly one
 * outcome, and side effects (Sage export cancel, Square cancel, email) run
 * only after the write landed.
 *
 * Simple invoice (invoices.status where invoice_kind is set):
 *
 *   draft ──finalize──▶ open ──void──▶ void        (void only while nothing is paid)
 *     ▲                  │ ▲
 *     └─────reopen───────┘ └─unpaid── partially_paid / paid
 *                        ├──paid_in_part──▶ partially_paid
 *                        └──paid_in_full──▶ paid
 *
 * The paid events follow the invoice's applied payments (Compass payments
 * and Square receipts); which one applies is computed from the amounts
 * (rules.ts invoicePaidValues).
 *
 * Square link (invoices.square_state), the Square invoice Compass creates
 * and emails a link to:
 *
 *   off | failed ──start──▶ pending ──publish──▶ published
 *                              └──fail──▶ failed
 *   pending | published | failed ──cancel──▶ canceled   (the invoice was voided)
 *
 * A pending link older than SQUARE_LINK_LEASE_MS may be started again (the
 * request that started it died).
 *
 * Received payment (payments.voided_at): recorded ──void──▶ void. Voiding
 * releases every allocation it holds in the same batch.
 */
import { defineMachine } from "@/lib/shared/state-machine"

import { INVOICE_SQUARE_STATES, SIMPLE_INVOICE_STATUSES } from "./statuses"

export const simpleInvoiceMachine = defineMachine({
  name: "simple invoice",
  states: SIMPLE_INVOICE_STATUSES,
  initial: "draft",
  terminal: ["void"],
  transitions: {
    // Numbered; it can now go to Sage, be emailed and take payments.
    finalize: { from: ["draft"], to: "open" },
    // Back to draft while nothing has gone out and nothing is paid (the action checks what went out).
    reopen: { from: ["open"], to: "draft" },
    // Kept for the record. Only an unpaid invoice; the store also requires amount_paid = 0.
    void: { from: ["open"], to: "void" },
    // Payments applied or released.
    paid_in_part: { from: ["open", "partially_paid", "paid"], to: "partially_paid" },
    paid_in_full: { from: ["open", "partially_paid", "paid"], to: "paid" },
    unpaid: { from: ["open", "partially_paid", "paid"], to: "open" },
  },
})

export type SimpleInvoiceEvent = keyof typeof simpleInvoiceMachine.transitions

/** Statuses (any invoice, simple or older) that never take a payment or a paid-state change. */
export const INVOICE_CLOSED_TO_PAYMENTS = ["draft", "void"] as const

/** How long a started Square invoice may stay "pending" before another request may start it again. */
export const SQUARE_LINK_LEASE_MS = 10 * 60 * 1000

export const squareLinkMachine = defineMachine({
  name: "simple invoice Square link",
  states: INVOICE_SQUARE_STATES,
  initial: "off",
  terminal: ["canceled"],
  transitions: {
    // A request claims the Square creation; only one creates the Square invoice.
    // From "pending" only once its lease ran out (the store checks updated_at).
    start: { from: ["off", "failed", "pending"], to: "pending" },
    publish: { from: ["pending"], to: "published" },
    fail: { from: ["pending"], to: "failed" },
    // The invoice was voided.
    cancel: { from: ["pending", "published", "failed"], to: "canceled" },
  },
})

export type SquareLinkEvent = keyof typeof squareLinkMachine.transitions

export const receivedPaymentMachine = defineMachine({
  name: "received payment",
  states: ["recorded", "void"],
  initial: "recorded",
  terminal: ["void"],
  transitions: {
    void: { from: ["recorded"], to: "void" },
  },
})
