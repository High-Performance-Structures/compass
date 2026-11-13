/**
 * Lifecycles of the Square → Sage tables (issue #1329, money sweep). Pure:
 * no database access. ./square-store.ts writes each event as a
 * compare-and-set on the event's source states.
 *
 * Square webhook event (sage_square_webhook_events.status), one row per
 * Square event id; Square delivers at least once and may retry:
 *
 *   processing ──complete──▶ processed
 *        ├──────fail──────▶ failed ──retry──▶ processing
 *        └──────flag──────▶ attention ──retry──▶ processing  (only known, fixable causes)
 *   processing ──retry──▶ processing   (the lease ran out: the request that held it died)
 *
 * complete, fail and flag are also fenced by the attempt that holds the
 * lease (attempt_count), so a request whose lease ran out can't overwrite
 * the outcome of the request that took over.
 *
 * Square payment operation (sage_square_payment_operations.status): a
 * receipt staff enter in Sage, or a processing fee the Sage writer posts.
 *
 *   fee:      queued ──claim──▶ running ──succeed──▶ succeeded
 *                                 ├──fail──▶ failed
 *                                 └──found_in_sage──▶ already_in_sage (the writer's duplicate scan)
 *             running ──claim──▶ running  (claim lease ran out)
 *   receipt:  manual_action_required ──found_in_sage──▶ already_in_sage (Compass saw it in Sage)
 *             queued | running ──hand_to_staff──▶ manual_action_required (older receipts)
 *   any but succeeded ──flag──▶ attention (Square changed or refunded the payment)
 */
import { defineMachine } from "@/lib/shared/state-machine"

import { SQUARE_PAYMENT_OPERATION_STATUSES, SQUARE_WEBHOOK_EVENT_STATUSES } from "./statuses"

export const squareWebhookEventMachine = defineMachine({
  name: "Square webhook event",
  states: SQUARE_WEBHOOK_EVENT_STATUSES,
  initial: "processing",
  terminal: ["processed"],
  transitions: {
    complete: { from: ["processing"], to: "processed" },
    // A transient failure (Square lookup, network); Square's retry or the recovery pass tries again.
    fail: { from: ["processing"], to: "failed" },
    // Needs a person (no matching project, refund, ...). No automatic retry bypasses it.
    flag: { from: ["processing"], to: "attention" },
    // From "processing" only once the lease ran out; from "attention" only for known fixable causes.
    retry: { from: ["failed", "processing", "attention"], to: "processing" },
  },
})

export type SquareWebhookEventEvent = keyof typeof squareWebhookEventMachine.transitions

export const squarePaymentOperationMachine = defineMachine({
  name: "Square payment operation",
  states: SQUARE_PAYMENT_OPERATION_STATUSES,
  initial: "queued",
  // Receipts start with staff: they enter them in Sage by hand.
  entry: ["manual_action_required"],
  terminal: ["succeeded", "attention"],
  transitions: {
    // The Sage writer takes a fee; from "running" only once the claim lease ran out.
    claim: { from: ["queued", "running"], to: "running" },
    succeed: { from: ["running"], to: "succeeded" },
    fail: { from: ["running"], to: "failed" },
    found_in_sage: { from: ["running", "manual_action_required"], to: "already_in_sage" },
    hand_to_staff: { from: ["queued", "running"], to: "manual_action_required" },
    flag: { from: ["queued", "running", "failed", "already_in_sage", "manual_action_required"], to: "attention" },
  },
})

export type SquarePaymentOperationEvent = keyof typeof squarePaymentOperationMachine.transitions
