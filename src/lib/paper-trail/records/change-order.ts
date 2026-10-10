import { count, eq, max } from "drizzle-orm"
import type { getDb } from "@/db"
import { projectChangeOrderDocuments, projectChangeOrderLines, projectChangeOrders } from "@/db/schema"
import type { LoadedPaperTrailRecord } from "@/lib/paper-trail/types"

export async function loadChangeOrderRecord(
  db: ReturnType<typeof getDb>,
  recordId: string,
): Promise<LoadedPaperTrailRecord | null> {
  const [order] = await db
    .select({ projectId: projectChangeOrders.projectId, number: projectChangeOrders.changeOrderNumber, title: projectChangeOrders.title, updatedAt: projectChangeOrders.updatedAt })
    .from(projectChangeOrders)
    .where(eq(projectChangeOrders.id, recordId))
    .limit(1)
  if (!order) return null
  const [[lines], [documents]] = await Promise.all([
    db.select({ latest: max(projectChangeOrderLines.updatedAt), count: count() }).from(projectChangeOrderLines).where(eq(projectChangeOrderLines.changeOrderId, recordId)),
    db.select({ latest: max(projectChangeOrderDocuments.createdAt), count: count() }).from(projectChangeOrderDocuments).where(eq(projectChangeOrderDocuments.changeOrderId, recordId)),
  ])
  const number = order.number?.trim() || "Unnumbered"
  return {
    projectId: order.projectId,
    version: [order.updatedAt, lines?.count ?? 0, lines?.latest ?? "", documents?.count ?? 0, documents?.latest ?? ""].join("|"),
    fileBaseName: `CO ${number} - ${order.title}`,
  }
}
