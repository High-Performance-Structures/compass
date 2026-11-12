/**
 * What Compass itself may do to an RFQ's or purchase order's status (issue
 * #1329, phase 2). Pure: no database access.
 *
 * Staff pick any of their company's statuses by hand (Settings › Statuses);
 * nothing here limits that. These machines cover only the automatic moves
 * that happen as a side effect of something else: an email going out, a
 * vendor answering, a bid being approved. Each event lists the built-in
 * statuses it may leave, and the store (store.ts) applies it as a
 * compare-and-set write, so automation never pulls a voided, closed,
 * completed or company-specific status back into the workflow.
 *
 *   RFQ:  draft ──send──▶ sent ──vendor_quote──▶ response_received ──award──▶ awarded
 *                          │  └──vendor_decline──▶ declined
 *         staff_quote / staff_decline: draft, sent, response_received or
 *         declined ──▶ response_received / declined (a response typed in by staff)
 *
 *   PO:   draft | approved ──send──▶ sent
 *         (approved is only ever set by staff)
 *
 * Every other built-in status (complete, closed, void, ordered, received,
 * ...) is staff-only: no automation moves a record into or out of it.
 */
import { defaultRecordStatusList, recordStatusExactKey } from "@/lib/domain/record-statuses/rules"
import { RECORD_STATUS_REGISTRY } from "@/lib/domain/record-statuses/registry"
import { defineMachine, nextState } from "@/lib/shared/state-machine"
import { isListValue } from "@/lib/shared/statuses"

export const rfqAutomation = defineMachine({
  name: "RFQ status automation",
  states: ["draft", "sent", "response_received", "declined", "awarded"],
  initial: "draft",
  // An awarded RFQ's bid is approved and locked.
  terminal: ["awarded"],
  transitions: {
    // The RFQ email was delivered, or its price page was shared from a draft.
    send: { from: ["draft", "sent"], to: "sent" },
    // The vendor answered in the portal or through the price link.
    vendor_quote: { from: ["sent", "response_received"], to: "response_received" },
    vendor_decline: { from: ["sent", "response_received"], to: "declined" },
    // Staff typed in a response that came by email or phone.
    staff_quote: { from: ["draft", "sent", "response_received", "declined"], to: "response_received" },
    staff_decline: { from: ["draft", "sent", "response_received", "declined"], to: "declined" },
    // The submitted bid was approved.
    award: { from: ["response_received"], to: "awarded" },
  },
})

export const purchaseOrderAutomation = defineMachine({
  name: "purchase order status automation",
  states: ["draft", "approved", "sent"],
  initial: "draft",
  terminal: ["sent"],
  transitions: {
    // The PO email was delivered, or the Nu-Tech manufacturer PO was released.
    send: { from: ["draft", "approved"], to: "sent" },
  },
})

export type RfqAutomationEvent = keyof typeof rfqAutomation.transitions
export type PurchaseOrderAutomationEvent = keyof typeof purchaseOrderAutomation.transitions

export type ProcurementAutomation =
  | { readonly kind: "rfq"; readonly event: RfqAutomationEvent }
  | { readonly kind: "purchase_order"; readonly event: PurchaseOrderAutomationEvent }

/** The built-in status a stored value really is (its key or a known spelling), or null for any other value. */
function builtInKey(kind: ProcurementAutomation["kind"], stored: string): string | null {
  return recordStatusExactKey(defaultRecordStatusList(kind), stored)
}

/**
 * The status `automation` moves a record with stored status `stored` to, or
 * null when the machine doesn't allow it from there (the record is left as
 * it is).
 */
export function automaticStatusAfter(automation: ProcurementAutomation, stored: string): string | null {
  const key = builtInKey(automation.kind, stored)
  if (automation.kind === "rfq") {
    if (!isListValue(rfqAutomation.states, key)) return null
    const next = nextState(rfqAutomation, key, automation.event)
    return next.ok ? next.to : null
  }
  if (!isListValue(purchaseOrderAutomation.states, key)) return null
  const next = nextState(purchaseOrderAutomation, key, automation.event)
  return next.ok ? next.to : null
}

function sourceStates(automation: ProcurementAutomation): readonly string[] {
  return automation.kind === "rfq"
    ? rfqAutomation.transitions[automation.event].from
    : purchaseOrderAutomation.transitions[automation.event].from
}

/**
 * Every stored spelling the event may move from: the source keys, their
 * registry aliases, and `stored` itself when it is one of them written
 * differently ("Draft"). The store's compare-and-set matches these exactly.
 */
export function automaticSourceSpellings(automation: ProcurementAutomation, stored: string): readonly string[] {
  const from = sourceStates(automation)
  const aliases = Object.entries(RECORD_STATUS_REGISTRY[automation.kind].aliases)
    .filter(([, key]) => from.includes(key))
    .map(([alias]) => alias)
  const storedKey = builtInKey(automation.kind, stored)
  const own = storedKey !== null && from.includes(storedKey) ? [stored] : []
  return [...new Set([...from, ...aliases, ...own])]
}
