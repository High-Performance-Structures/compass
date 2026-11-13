/**
 * The Sage write queues' lifecycles (issue #1329, money sweep). Each row is
 * one request for the installed Sage writer on the office PC; its status
 * changes only through these events, which the owning store applies as
 * compare-and-set writes on the event's source states. Pure: no database.
 *
 * Every writer queue has the same core:
 *
 *   queued ──claim──▶ running ──succeed──▶ succeeded
 *                     │  ▲ └──fail──▶ failed ──resend──▶ queued
 *                     └──┘ reclaim (a claim older than the stale cutoff;
 *                          the writer itself refuses to add what Sage has)
 *
 * and each table adds what its workflow needs (waiting for the Sage job,
 * a guard that stops a request for staff, a cancelled billing). The writer
 * only ever learns a request through a claim, and a result only lands while
 * the row is still running under that claim's token, so two polls, a retry
 * or a staff resend can't post the same request twice from Compass's side.
 */
import { defineMachine, type Machine } from "@/lib/shared/state-machine"

import {
  SAGE_AR_INVOICE_EXPORT_STATUSES,
  SAGE_CHANGE_ORDER_EXPORT_STATUSES,
  SAGE_CLIENT_PROJECT_WRITE_STATUSES,
  SAGE_DIRECTORY_ADD_STATUSES,
  SAGE_ESTIMATE_EXPORT_STATUSES,
  SAGE_VENDOR_CERTIFICATE_SYNC_STATUSES,
} from "./statuses"

/** Client, job, vendor and job tax district writes (sage_client_project_write_operations). */
export const clientProjectWriteMachine = defineMachine({
  name: "Sage client/job write",
  states: SAGE_CLIENT_PROJECT_WRITE_STATUSES,
  initial: "queued",
  terminal: ["succeeded"],
  transitions: {
    // A writer poll took it (or took over a claim gone stale).
    claim: { from: ["queued", "running"], to: "running" },
    // The writer reported Sage's client/job/vendor, or the stored payload was unreadable.
    succeed: { from: ["running"], to: "succeeded" },
    fail: { from: ["running"], to: "failed" },
    // Staff pressed Send to Sage, or an estimate sent the job round again.
    resend: { from: ["failed"], to: "queued" },
  },
})

/** Change orders and variances sent to Sage as approved prime change orders. */
export const changeOrderExportMachine = defineMachine({
  name: "Sage change order export",
  states: SAGE_CHANGE_ORDER_EXPORT_STATUSES,
  initial: "queued",
  terminal: ["succeeded"],
  transitions: {
    claim: { from: ["queued", "running"], to: "running" },
    succeed: { from: ["running"], to: "succeeded" },
    fail: { from: ["running"], to: "failed" },
    // Staff sent the change order again.
    resend: { from: ["failed"], to: "queued" },
  },
})

/** A vendor's certificate sync; queued again whenever their trade docs change. */
export const vendorCertificateSyncMachine = defineMachine({
  name: "Sage vendor certificate sync",
  states: SAGE_VENDOR_CERTIFICATE_SYNC_STATUSES,
  initial: "queued",
  terminal: [],
  transitions: {
    // Trade docs changed (a running sync is left running; it goes round again when it reports).
    queue: { from: ["queued", "succeeded", "failed"], to: "queued" },
    claim: { from: ["queued", "running"], to: "running" },
    succeed: { from: ["running"], to: "succeeded" },
    fail: { from: ["running"], to: "failed" },
    // The docs changed while the writer worked: the result stands, and it goes round again.
    requeue_changed: { from: ["running"], to: "queued" },
  },
})

/** An accepted estimate's proposal (and budget) sent to Sage. */
export const estimateExportMachine = defineMachine({
  name: "Sage estimate export",
  states: SAGE_ESTIMATE_EXPORT_STATUSES,
  initial: "queued",
  entry: ["waiting_for_job", "needs_attention"],
  terminal: ["succeeded"],
  transitions: {
    // Accepted or sent again (Send to Sage); a running or finished row is left alone.
    queue: { from: ["queued", "waiting_for_job", "failed", "needs_attention"], to: "queued" },
    // Sent before Sage has the job, or the job write was sent (it follows the job).
    wait_for_job: { from: ["queued", "waiting_for_job", "failed", "needs_attention", "running"], to: "waiting_for_job" },
    // A guard stopped it, at queue time, at claim time, or in the writer.
    flag: { from: ["queued", "waiting_for_job", "failed", "needs_attention", "running"], to: "needs_attention" },
    claim: { from: ["queued", "waiting_for_job", "running"], to: "running" },
    succeed: { from: ["running"], to: "succeeded" },
    fail: { from: ["running"], to: "failed" },
  },
})

/**
 * A billed pay request, simple invoice (credit memo) or deposit request sent
 * to Sage as an AR invoice. The three tables share this lifecycle.
 */
export const arInvoiceExportMachine = defineMachine({
  name: "Sage AR invoice export",
  states: SAGE_AR_INVOICE_EXPORT_STATUSES,
  initial: "queued",
  entry: ["needs_attention"],
  terminal: ["succeeded"],
  transitions: {
    // Billed, or sent again; a running or succeeded row is left alone.
    queue: { from: ["queued", "failed", "needs_attention", "cancelled"], to: "queued" },
    // A guard stopped it, at queue or claim time; the writer stopped it; or
    // Sage's total read back differently (the invoice is in Sage).
    flag: { from: ["queued", "failed", "needs_attention", "cancelled", "running"], to: "needs_attention" },
    claim: { from: ["queued", "running"], to: "running" },
    succeed: { from: ["running"], to: "succeeded" },
    fail: { from: ["running"], to: "failed" },
    // The billing was taken back (or the invoice voided) before it reached Sage.
    cancel: { from: ["queued", "failed", "needs_attention", "cancelled"], to: "cancelled" },
  },
})

/**
 * "Request add to Sage" for a vendor, client or one of their people. Nothing
 * goes to the writer before the approver approves; "sent" is taken before the
 * writer's request is queued, so a withdrawal and an approval can't both win.
 */
export const directoryAddMachine = defineMachine({
  name: "Sage add request",
  states: SAGE_DIRECTORY_ADD_STATUSES,
  initial: "pending",
  terminal: ["succeeded", "failed", "rejected", "cancelled"],
  transitions: {
    approve: { from: ["pending"], to: "approved" },
    reject: { from: ["pending"], to: "rejected" },
    // The requester or approver withdrew it before it went to Sage.
    withdraw: { from: ["pending", "approved"], to: "cancelled" },
    // Handed to the Sage writer (a person waits "approved" until its company is in Sage).
    send: { from: ["approved"], to: "sent" },
    // Queuing the writer's request failed after "sent" was taken: it waits again.
    unsend: { from: ["sent"], to: "approved" },
    // The writer's answer.
    succeed: { from: ["sent"], to: "succeeded" },
    fail: { from: ["sent"], to: "failed" },
  },
})

export type DirectoryAddEvent = keyof typeof directoryAddMachine.transitions

/**
 * Every state some event may move a row from into `to`. A store that is
 * handed a target status (not an event) fences its write on these, so no
 * write can make a move the machine doesn't declare (a cancelled export
 * becoming succeeded, say).
 */
export function sourcesInto<State extends string, Event extends string>(
  machine: Machine<State, Event>,
  to: State
): readonly State[] {
  const sources = new Set<State>()
  for (const rule of Object.values<{ readonly from: readonly State[]; readonly to: State }>(machine.transitions)) {
    if (rule.to === to) for (const state of rule.from) sources.add(state)
  }
  return [...sources]
}
