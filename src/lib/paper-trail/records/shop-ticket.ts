import { count, eq, max } from "drizzle-orm"
import type { getDb } from "@/db"
import { shopTicketLines, shopTickets } from "@/db/schema-shop-tickets"
import {
  LEGACY_RECEIPTS_FOLDER_NAMES,
  legacyPayApplicationFolderNames,
  PAY_APPLICATION_RECEIPTS_FOLDER,
  payApplicationFolderName,
} from "@/lib/shop-tickets/model"
import { recordNumberKeys } from "@/lib/paper-trail/duplicates"
import type { LoadedPaperTrailRecord } from "@/lib/paper-trail/types"

/**
 * Issued and voided tickets are saved; drafts are not. The copy goes in the
 * draw's receipts folder under pay requests, which is created from the
 * template names when the draw does not have one yet.
 */
export async function loadShopTicketRecord(
  db: ReturnType<typeof getDb>,
  recordId: string,
): Promise<LoadedPaperTrailRecord | null> {
  const [ticket] = await db
    .select({
      projectId: shopTickets.projectId,
      number: shopTickets.ticketNumber,
      status: shopTickets.status,
      updatedAt: shopTickets.updatedAt,
      payApplicationNumber: shopTickets.payApplicationNumber,
      payApplicationMonth: shopTickets.payApplicationMonth,
    })
    .from(shopTickets)
    .where(eq(shopTickets.id, recordId))
    .limit(1)
  if (!ticket || ticket.status === "draft") return null
  const [lines] = await db
    .select({ latest: max(shopTicketLines.updatedAt), count: count() })
    .from(shopTicketLines)
    .where(eq(shopTicketLines.ticketId, recordId))
  const drawFolder = payApplicationFolderName(ticket.payApplicationNumber, ticket.payApplicationMonth)
  return {
    projectId: ticket.projectId,
    version: [ticket.updatedAt, ticket.status, lines?.count ?? 0, lines?.latest ?? ""].join("|"),
    fileBaseName: `Shop Ticket ${ticket.number}${ticket.status === "void" ? " - VOID" : ""}`,
    subfolders: drawFolder
      ? [
          { name: drawFolder, alternatives: legacyPayApplicationFolderNames(ticket.payApplicationMonth) },
          { name: PAY_APPLICATION_RECEIPTS_FOLDER, alternatives: LEGACY_RECEIPTS_FOLDER_NAMES },
        ]
      : [],
    duplicateKeys: recordNumberKeys(ticket.number, ["Shop Ticket"]),
  }
}
