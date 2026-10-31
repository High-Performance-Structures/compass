/**
 * The only code that inserts, updates, or deletes trade_letters
 * (architecture standard, section 1). No auth here: callers resolve access
 * first (staff estimate access, or a verified Foxit webhook).
 */
import { eq } from "drizzle-orm"

import { tradeLetters } from "@/db/schema-trade-docs"
import { TRADE_LETTER_KINDS, TRADE_LETTER_STATUSES } from "@/lib/domain/trade-letters/statuses"
import type { Db } from "@/lib/server/action-context"
import { assertListFields } from "@/lib/shared/statuses"

// Enumerated columns are checked against their shared lists before every write.
const LETTER_LISTS = { kind: TRADE_LETTER_KINDS, status: TRADE_LETTER_STATUSES }

type TradeLetterInsert = typeof tradeLetters.$inferInsert
type TradeLetterUpdate = Partial<Omit<TradeLetterInsert, "id">>

export async function insertTradeLetter(db: Db, row: TradeLetterInsert): Promise<void> {
  assertListFields("trade_letters", row, LETTER_LISTS)
  await db.insert(tradeLetters).values(row).run()
}

export async function updateTradeLetter(db: Db, letterId: string, values: TradeLetterUpdate): Promise<void> {
  assertListFields("trade_letters", values, LETTER_LISTS)
  await db.update(tradeLetters).set(values).where(eq(tradeLetters.id, letterId)).run()
}

export async function deleteTradeLetter(db: Db, letterId: string): Promise<void> {
  await db.delete(tradeLetters).where(eq(tradeLetters.id, letterId)).run()
}
