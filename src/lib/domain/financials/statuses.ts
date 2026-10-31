/*
 * Enumerated values for received payments (architecture standard, section 3).
 * Pure constants with no imports, so rules, actions and components share them.
 */

/** How staff record that a customer paid. Square card payments arrive through the Square bridge. */
export const RECEIVED_PAYMENT_METHODS = ["check", "cash", "ach", "card"] as const

/** Readable label for a payment method, including the Square bridge's "square". */
export function paymentMethodLabel(method: string | null | undefined): string {
  if (method === "ach") return "ACH"
  if (method === "square") return "Square"
  if (!method) return "-"
  return method.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase())
}

/** The kinds of billed item a received payment can be applied to. */
export const RECEIVABLE_ITEM_KINDS = ["pay_application", "invoice"] as const
export type ReceivableItemKind = (typeof RECEIVABLE_ITEM_KINDS)[number]

/** Paid state of a billed item, derived from its billed amount and active allocations. */
const RECEIVABLE_PAID_STATES = ["open", "partially_paid", "paid"] as const
export type ReceivablePaidState = (typeof RECEIVABLE_PAID_STATES)[number]
