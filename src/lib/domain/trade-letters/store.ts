/**
 * The only code that inserts, updates, or deletes trade_letters
 * (architecture standard, section 1). No auth here: callers resolve access
 * first (staff estimate access, or a verified Foxit webhook).
 */
import { eq } from "drizzle-orm"

import { tradeLetters } from "@/db/schema-trade-docs"
import { TRADE_LETTER_KINDS, TRADE_LETTER_STATUSES } from "@/lib/domain/trade-letters/statuses"
import { companyMoveGuard, type CompanyReferenceMove } from "@/lib/domain/contacts/company-merge-references"
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

/** Moves a merged vendor's trade letters to the kept vendor; the name on each letter is what was sent and stays. */
export function companyMergeTradeLetterStatements(database: D1Database, move: CompanyReferenceMove): D1PreparedStatement[] {
  if (move.side !== "vendor") return []
  const guard = companyMoveGuard(move)
  return [database.prepare(`UPDATE trade_letters SET vendor_id = ?, updated_at = ? WHERE vendor_id = ? AND organization_id = ? AND ${guard.sql}`)
    .bind(move.destinationId, move.now, move.sourceId, move.organizationId, ...guard.binds)]
}
