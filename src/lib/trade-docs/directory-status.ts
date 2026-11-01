import { and, inArray, isNull, sql } from "drizzle-orm"

import { vendorTradeDocuments } from "@/db/schema-trade-docs"
import { chunkD1Values } from "@/lib/d1-query"
import type { Db } from "@/lib/server/action-context"
import { toTradeDocOnFile } from "@/lib/trade-docs/records"
import type { TradeDocType } from "@/lib/trade-docs/settings"
import { summarizeTradeDocs, type TradeDocOnFile } from "@/lib/trade-docs/status"

export type VendorTradeDocStatus = {
  readonly label: string
  readonly requiredCount: number
  readonly goodCount: number
  readonly owedCount: number
  readonly expiringCount: number
}

/**
 * Trade doc standing for the vendors on one directory page. Only those
 * vendors' current documents are read; vendors that need nothing are absent.
 */
export async function tradeDocStatusesForVendors(input: {
  readonly db: Db
  readonly organizationId: string
  readonly docTypes: readonly TradeDocType[]
  readonly vendors: readonly { readonly id: string; readonly category: string }[]
  readonly today: string
}): Promise<Readonly<Record<string, VendorTradeDocStatus>>> {
  if (input.vendors.length === 0) return {}
  const chunks = await Promise.all(chunkD1Values(input.vendors.map((vendor) => vendor.id)).map((ids) =>
    input.db
      .select()
      .from(vendorTradeDocuments)
      .where(and(
        // Unary + keeps SQLite on the vendor index (a page's vendors) instead of
        // the organization index, which would read every vendor's documents.
        sql`+${vendorTradeDocuments.organizationId} = ${input.organizationId}`,
        inArray(vendorTradeDocuments.vendorId, ids),
        isNull(vendorTradeDocuments.supersededAt),
      ))))
  const docsByVendor = new Map<string, TradeDocOnFile[]>()
  for (const row of chunks.flat()) {
    const list = docsByVendor.get(row.vendorId) ?? []
    list.push(toTradeDocOnFile(row))
    docsByVendor.set(row.vendorId, list)
  }
  const statuses: Record<string, VendorTradeDocStatus> = {}
  for (const vendor of input.vendors) {
    const summary = summarizeTradeDocs({
      docTypes: input.docTypes,
      vendorCategory: vendor.category,
      docs: docsByVendor.get(vendor.id) ?? [],
      today: input.today,
    })
    if (summary.requiredCount === 0 && summary.lines.length === 0) continue
    statuses[vendor.id] = {
      label: summary.requiredCount === 0 ? "On file" : `${summary.goodCount} of ${summary.requiredCount}`,
      requiredCount: summary.requiredCount,
      goodCount: summary.goodCount,
      owedCount: summary.owed.length,
      expiringCount: summary.expiringCount,
    }
  }
  return statuses
}
