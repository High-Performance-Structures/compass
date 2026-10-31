/**
 * The only code that inserts, updates, or deletes trade_letters
 * (architecture standard, section 1). No auth here: callers resolve access
 * first (staff estimate access, or a verified Foxit webhook).
 */
import { eq } from "drizzle-orm"

import { tradeLetters } from "@/db/schema-trade-docs"
import type { Db } from "@/lib/server/action-context"

type TradeLetterInsert = typeof tradeLetters.$inferInsert
type TradeLetterUpdate = Partial<Omit<TradeLetterInsert, "id">>

export async function insertTradeLetter(db: Db, row: TradeLetterInsert): Promise<void> {
  await db.insert(tradeLetters).values(row).run()
}

export async function updateTradeLetter(db: Db, letterId: string, values: TradeLetterUpdate): Promise<void> {
  await db.update(tradeLetters).set(values).where(eq(tradeLetters.id, letterId)).run()
}

export async function deleteTradeLetter(db: Db, letterId: string): Promise<void> {
  await db.delete(tradeLetters).where(eq(tradeLetters.id, letterId)).run()
}
