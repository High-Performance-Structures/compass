import { and, asc, eq, lt, or } from "drizzle-orm"

import { sageChangeOrderExports } from "@/db/schema-sage"
import { claimSageChangeOrderExport, updateSageChangeOrderExportsStatement } from "@/lib/domain/sage-bridge/change-order-store"
import { sageBridgeBatchLimit, sageBridgeCutoff } from "@/lib/domain/sage-bridge/rules"
import { authorizeSageChangeOrderBridge, CHANGE_ORDER_WRITER } from "@/lib/sage/change-order-bridge"
import { sageChangeOrderWritePayloadSchema } from "@/lib/sage/change-order-write"

const MAX_BATCH = 10
const CLAIM_RETRY_MILLISECONDS = 10 * 60 * 1000

/**
 * The Sage writer's poll: claims up to `limit` change orders staff sent to
 * Sage, each with the request staff confirmed (number, date, description,
 * lines). The payload is checked again before it leaves Compass.
 */
export async function GET(request: Request): Promise<Response> {
  const bridge = await authorizeSageChangeOrderBridge(request, "", CHANGE_ORDER_WRITER)
  if (!bridge.success) return bridge.response
  const { db, organizationId } = bridge
  const now = new Date()
  const nowIso = now.toISOString()
  const staleBefore = sageBridgeCutoff(now, CLAIM_RETRY_MILLISECONDS)
  const limit = sageBridgeBatchLimit(new URL(request.url).searchParams.get("limit"), 5, MAX_BATCH)
  const candidates = await db
    .select({ id: sageChangeOrderExports.id })
    .from(sageChangeOrderExports)
    .where(
      and(
        eq(sageChangeOrderExports.organizationId, organizationId),
        or(
          eq(sageChangeOrderExports.status, "queued"),
          and(eq(sageChangeOrderExports.status, "running"), lt(sageChangeOrderExports.claimedAt, staleBefore))
        )
      )
    )
    .orderBy(asc(sageChangeOrderExports.requestedAt))
    .limit(limit)

  const requests: unknown[] = []
  // At most MAX_BATCH claims per poll, each fenced on its own row.
  for (const candidate of candidates) {
    const claimToken = crypto.randomUUID()
    if (!(await claimSageChangeOrderExport(db, { id: candidate.id, organizationId, claimToken, now: nowIso, staleBefore }))) continue
    const claimed = await db
      .select({ payloadJson: sageChangeOrderExports.payloadJson })
      .from(sageChangeOrderExports)
      .where(and(eq(sageChangeOrderExports.id, candidate.id), eq(sageChangeOrderExports.claimToken, claimToken)))
      .get()
    let raw: unknown = null
    try {
      raw = claimed ? JSON.parse(claimed.payloadJson) : null
    } catch {
      raw = null
    }
    const payload = sageChangeOrderWritePayloadSchema.safeParse(raw)
    if (!payload.success) {
      await updateSageChangeOrderExportsStatement(
        db,
        and(eq(sageChangeOrderExports.id, candidate.id), eq(sageChangeOrderExports.claimToken, claimToken)),
        { status: "failed", errorMessage: "Stored Sage change order failed validation; send it again.", completedAt: nowIso, updatedAt: nowIso }
      )
      continue
    }
    requests.push({ id: candidate.id, claimToken, payload: payload.data })
  }
  return Response.json({ organizationId, requests })
}
