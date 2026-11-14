/*
 * Enumerated values for this domain (architecture standard, section 3).
 * Pure constants with no imports, so the Drizzle schema can type its
 * columns with them.
 */

export const SHOP_TICKET_STATUSES = ["draft", "issued", "void"] as const
export type ShopTicketStatus = (typeof SHOP_TICKET_STATUSES)[number]

export const SHOP_TICKET_RATE_KINDS = ["labor", "machine"] as const
export type ShopTicketRateKind = (typeof SHOP_TICKET_RATE_KINDS)[number]

/**
 * How a shop ticket is billed on a pay application: "imported" amounts were
 * added to G703 lines; "already_included" marks a ticket staff typed in by
 * hand, recorded as billed without changing any line.
 */
export const PAY_APPLICATION_SHOP_TICKET_IMPORT_MODES = ["imported", "already_included"] as const

export const RATE_BOOK_FUEL_TYPES = ["none", "diesel", "regular"] as const

export const RATE_BOOK_ENTRY_STATUSES = ["active", "retired"] as const

export const RATE_BOOK_CATEGORIES = [
  "labor",
  "machine",
  "delivery",
  "fuel",
  "travel",
  "lodging",
  "rental",
  "material",
  "subcontract",
  "other",
] as const
export type RateBookCategory = (typeof RATE_BOOK_CATEGORIES)[number]

/**
 * A recipient vendor's answer to an RFQ (project_rfq_recipients). Only vendors
 * who answered are recorded; invited-but-silent vendors get no row.
 */
export const RFQ_RECIPIENT_RESPONSE_STATUSES = ["quoted", "declined"] as const
