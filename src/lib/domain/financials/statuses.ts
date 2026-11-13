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
export type ReceivablePaidState = "open" | "partially_paid" | "paid"

/*
 * Simple invoices built in Compass (Nu-Tech sales and one-off work): their
 * kind (which Sage invoice number format they use), where each line came
 * from, and the Square invoice's state.
 */

/**
 * "nutech_sale" uses the material sale format ({project}-S01); "other" the
 * other billing format ({project}-INV01); "credit_memo" the credit memo format
 * ({project}-CM01). A credit memo's lines and totals are stored as positive
 * amounts (what is credited); it goes to Sage as an AR invoice with negative
 * lines, and never takes payments or a Square link.
 */
export const SIMPLE_INVOICE_KINDS = ["nutech_sale", "other", "credit_memo"] as const
export type SimpleInvoiceKind = (typeof SIMPLE_INVOICE_KINDS)[number]

export function isCreditMemoKind(kind: string | null | undefined): boolean {
  return kind === "credit_memo"
}

/** Draft (editable), open (final: numbered, can go to Sage, be emailed and take payments), paid states, void. */
export const SIMPLE_INVOICE_STATUSES = ["draft", "open", "partially_paid", "paid", "void"] as const

/** An invoice line from an estimate line (counts toward the estimate's invoiced-to-date) or added on the invoice. */
export const INVOICE_LINE_SOURCES = ["estimate", "added"] as const
export type InvoiceLineSource = (typeof INVOICE_LINE_SOURCES)[number]

/** The price list column an invoice prices catalog items from (Square always uses the regular price). */
export const INVOICE_PRICE_MODES = ["standard", "cash_discount"] as const
export type InvoicePriceMode = (typeof INVOICE_PRICE_MODES)[number]

export const INVOICE_CUSTOMER_TYPES = ["new", "returning"] as const
export type InvoiceCustomerType = (typeof INVOICE_CUSTOMER_TYPES)[number]

/** The Square invoice Compass creates for a simple invoice ("off" when the box isn't checked). */
export const INVOICE_SQUARE_STATES = ["off", "pending", "published", "failed", "canceled"] as const

/** A contract deposit: requested from the client, received, or voided (see deposit-machine.ts). */
export const CONTRACT_DEPOSIT_STATUSES = ["requested", "received", "void"] as const
export type ContractDepositStatus = (typeof CONTRACT_DEPOSIT_STATUSES)[number]
