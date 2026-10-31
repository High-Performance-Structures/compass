/*
 * Enumerated values for this domain (architecture standard, section 3).
 * Pure constants with no imports, so the Drizzle schema can type its
 * columns with them.
 */

export const TRADE_LETTER_KINDS = ["intent", "award"] as const
export type TradeLetterKind = (typeof TRADE_LETTER_KINDS)[number]

export const TRADE_LETTER_STATUSES = ["draft", "preparing", "sent", "signed", "declined", "cancelled"] as const
export type TradeLetterStatus = (typeof TRADE_LETTER_STATUSES)[number]
