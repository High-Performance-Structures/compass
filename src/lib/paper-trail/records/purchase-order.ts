import { and, count, eq, max } from "drizzle-orm"
import type { getDb } from "@/db"
import { projectOperations, projectPurchaseOrderLines } from "@/db/schema"
import type { LoadedPaperTrailRecord } from "@/lib/paper-trail/types"

export async function loadPurchaseOrderRecord(
  db: ReturnType<typeof getDb>,
  recordId: string,
): Promise<LoadedPaperTrailRecord | null> {
  const [order] = await db
    .select({ projectId: projectOperations.projectId, number: projectOperations.sourceRecordNumber, title: projectOperations.title, updatedAt: projectOperations.updatedAt })
    .from(projectOperations)
    .where(and(eq(projectOperations.id, recordId), eq(projectOperations.sourceRecordType, "purchase_order")))
    .limit(1)
  if (!order) return null
  const [lines] = await db
    .select({ latest: max(projectPurchaseOrderLines.updatedAt), count: count() })
    .from(projectPurchaseOrderLines)
    .where(eq(projectPurchaseOrderLines.operationId, recordId))
  const number = order.number?.trim() || "Unnumbered"
  return {
    projectId: order.projectId,
    version: [order.updatedAt, lines?.count ?? 0, lines?.latest ?? ""].join("|"),
    fileBaseName: `PO ${number}${order.title ? ` - ${order.title}` : ""}`,
  }
}
