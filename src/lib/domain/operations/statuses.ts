/*
 * Enumerated values for this domain (architecture standard, section 3).
 * Pure constants with no imports, so the Drizzle schema can type its
 * columns with them.
 */

export const SHOP_TICKET_STATUSES = ["draft", "issued", "void"] as const
export type ShopTicketStatus = (typeof SHOP_TICKET_STATUSES)[number]

export const SHOP_TICKET_RATE_KINDS = ["labor", "machine"] as const
export type ShopTicketRateKind = (typeof SHOP_TICKET_RATE_KINDS)[number]

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
