import "server-only"

import { and, eq, inArray } from "drizzle-orm"

import type { getDb } from "@/db"
import { projectOperations, projectPurchaseOrderLines } from "@/db/schema"
import { chunkD1Values } from "@/lib/d1-query"

type Db = ReturnType<typeof getDb>

export type TradePurchaseOrder = {
  readonly id: string
  readonly number: string | null
  readonly title: string
  readonly status: string
  readonly amountCents: number
  readonly lines: readonly { readonly costCode: string | null; readonly amountCents: number }[]
}

function cents(dollars: number | null): number {
  return Math.round((dollars ?? 0) * 100)
}

/** This job's POs drawn against each accepted quote, keyed by the quote's RFQ. */
export async function loadTradePurchaseOrders(db: Db, projectId: string, rfqIds: readonly string[]): Promise<ReadonlyMap<string, readonly TradePurchaseOrder[]>> {
  const byRfq = new Map<string, TradePurchaseOrder[]>()
  if (rfqIds.length === 0) return byRfq
  const orders: (typeof projectOperations.$inferSelect)[] = []
  for (const ids of chunkD1Values(rfqIds)) {
    orders.push(
      ...(await db
        .select()
        .from(projectOperations)
        .where(and(eq(projectOperations.projectId, projectId), eq(projectOperations.sourceRecordType, "purchase_order"), inArray(projectOperations.awardedRfqId, ids)))),
    )
  }
  const lines: (typeof projectPurchaseOrderLines.$inferSelect)[] = []
  for (const ids of chunkD1Values(orders.map((order) => order.id))) {
    lines.push(...(await db.select().from(projectPurchaseOrderLines).where(inArray(projectPurchaseOrderLines.operationId, ids))))
  }
  for (const order of orders.sort((left, right) => left.createdAt.localeCompare(right.createdAt))) {
    if (!order.awardedRfqId) continue
    const list = byRfq.get(order.awardedRfqId) ?? []
    list.push({
      id: order.id,
      number: order.sourceRecordNumber,
      title: order.title,
      status: order.status,
      amountCents: cents(order.amount),
      lines: lines.filter((line) => line.operationId === order.id).map((line) => ({ costCode: line.costCode, amountCents: cents(line.amount) })),
    })
    byRfq.set(order.awardedRfqId, list)
  }
  return byRfq
}
