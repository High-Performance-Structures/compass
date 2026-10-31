/**
 * Shared reads of the correspondence and inbound email tables. Writes live in
 * store.ts and email-store.ts.
 */
import { inArray } from "drizzle-orm"

import { inboundEmails } from "@/db/schema"
import { chunkD1Values } from "@/lib/d1-query"
import type { Db } from "@/lib/server/action-context"

/**
 * Stored matched_status by Gmail message id. gmail_message_id is unique, so
 * each id has at most one row; ids are read 50 at a time (D1 bound limit)
 * instead of one query per message.
 */
export async function inboundEmailStatuses(
  db: Db,
  gmailMessageIds: readonly string[]
): Promise<Map<string, string>> {
  const statuses = new Map<string, string>()
  for (const chunk of chunkD1Values(gmailMessageIds)) {
    const rows = await db
      .select({ gmailMessageId: inboundEmails.gmailMessageId, status: inboundEmails.matchedStatus })
      .from(inboundEmails)
      .where(inArray(inboundEmails.gmailMessageId, chunk))
    for (const row of rows) statuses.set(row.gmailMessageId, row.status)
  }
  return statuses
}
