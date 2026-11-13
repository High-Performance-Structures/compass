import { and, eq, sql } from "drizzle-orm"

import { projectChangeOrders } from "@/db/schema"
import { sageChangeOrderExports } from "@/db/schema-sage"
import { insertChangeOrderHistoryStatement, updateChangeOrdersStatement } from "@/lib/domain/estimates/store"
import { updateSageChangeOrderExportsStatement } from "@/lib/domain/sage-bridge/change-order-store"
import { releaseSageResultLease, sageResultAlreadyRecorded, takeSageResultLease } from "@/lib/domain/sage-bridge/store"
import { readBoundedSageBridgeBody } from "@/lib/sage/bridge-auth"
import { authorizeSageChangeOrderBridge, CHANGE_ORDER_WRITER } from "@/lib/sage/change-order-bridge"
import { sageChangeOrderWriteResultSchema } from "@/lib/sage/change-order-write"

/** The Sage writer reports one change order: added (or found) in Sage, or why not. */
export async function POST(request: Request): Promise<Response> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "Content-Type must be application/json" }, { status: 415 })
  }
  const body = await readBoundedSageBridgeBody(request)
  if (!body.success) return Response.json({ error: body.error }, { status: 413 })
  const bridge = await authorizeSageChangeOrderBridge(request, body.rawBody, CHANGE_ORDER_WRITER)
  if (!bridge.success) return bridge.response
  let raw: unknown
  try {
    raw = JSON.parse(body.rawBody)
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = sageChangeOrderWriteResultSchema.safeParse(raw)
  if (!parsed.success) return Response.json({ error: "Invalid change order result" }, { status: 400 })
  const result = parsed.data
  const { db, organizationId } = bridge
  const fence = and(
    eq(sageChangeOrderExports.id, result.id),
    eq(sageChangeOrderExports.organizationId, organizationId),
    eq(sageChangeOrderExports.status, "running"),
    eq(sageChangeOrderExports.claimToken, result.claimToken)
  )
  const row = await db
    .select({
      projectId: sageChangeOrderExports.projectId,
      changeOrderId: sageChangeOrderExports.changeOrderId,
      sageChangeOrderNumber: sageChangeOrderExports.sageChangeOrderNumber,
    })
    .from(sageChangeOrderExports)
    .where(fence)
    .get()
  // An exact repeat of a result that already landed is answered as recorded:
  // the writer stops its whole run on any non-2xx answer.
  const staleOrRepeat = async (): Promise<Response> => {
    const recorded = await sageResultAlreadyRecorded(db, "sage_change_order_exports", {
      id: result.id, organizationId, claimToken: result.claimToken, statuses: [result.outcome],
    })
    return recorded
      ? Response.json({ success: true, status: recorded, alreadyRecorded: true })
      : Response.json({ error: "Change order claim changed" }, { status: 409 })
  }
  if (!row) return staleOrRepeat()
  // One handler per claim: a result posted twice applies (and logs) once.
  const leaseToken = await takeSageResultLease(db, "sage_change_order_exports", { id: result.id, organizationId, claimToken: result.claimToken, now: new Date().toISOString() })
  if (!leaseToken) return staleOrRepeat()
  // A throw while applying hands the lease back, so the claim is neither stuck nor half-applied.
  try {
    const leased = and(
      eq(sageChangeOrderExports.id, result.id),
      eq(sageChangeOrderExports.organizationId, organizationId),
      eq(sageChangeOrderExports.claimToken, leaseToken)
    )
    const now = new Date().toISOString()

    if (result.outcome === "failed") {
      const updated = await updateSageChangeOrderExportsStatement(db, leased, {
        status: "failed",
        errorMessage: result.error,
        completedAt: now,
        updatedAt: now,
      }).returning({ id: sageChangeOrderExports.id })
      if (updated.length !== 1) return Response.json({ error: "Change order claim changed" }, { status: 409 })
      return Response.json({ success: true, status: "failed" }, { status: 202 })
    }

    // The export row is fenced on the lease; the change order is written in
    // the same batch, only if that update landed, so they can't disagree.
    const results = await db.batch([
      updateSageChangeOrderExportsStatement(db, leased, {
        status: "succeeded",
        sageRecordId: result.sageRecordId,
        errorMessage: null,
        completedAt: now,
        updatedAt: now,
      }).returning({ id: sageChangeOrderExports.id }),
      updateChangeOrdersStatement(
        db,
        and(
          eq(projectChangeOrders.id, row.changeOrderId),
          eq(projectChangeOrders.projectId, row.projectId),
          // Only when the export update above still held the claim.
          sql`EXISTS (SELECT 1 FROM sage_change_order_exports WHERE id = ${result.id} AND status = 'succeeded' AND claim_token = ${leaseToken})`
        ),
        { sageRecordId: result.sageRecordId, sageStatus: "in_sage", lastSageSyncAt: now, updatedAt: now }
      ),
    ])
    if (results[0].length !== 1) return Response.json({ error: "Change order claim changed" }, { status: 409 })
    // History only once the export update landed under this lease; a log row
    // that fails to write never fails the result Sage already has.
    try {
      await insertChangeOrderHistoryStatement(db, {
        id: crypto.randomUUID(),
        projectId: row.projectId,
        changeOrderId: row.changeOrderId,
        eventType: result.alreadyInSage ? "sage_matched" : "sage_added",
        fromStatus: null,
        toStatus: null,
        actorUserId: null,
        actorName: "Sage writer",
        actorRole: "system",
        note: result.alreadyInSage
          ? `Sage already had change order ${row.sageChangeOrderNumber}; Compass linked it.`
          : `Added to Sage as approved change order ${row.sageChangeOrderNumber}.`,
        metadataJson: JSON.stringify({ sageRecordId: result.sageRecordId }),
        createdAt: now,
      })
    } catch (error) {
      console.error("Sage change order history could not be recorded", error)
    }
    return Response.json({ success: true, status: "succeeded" })
  } catch (error) {
    await releaseSageResultLease(db, "sage_change_order_exports", { id: result.id, claimToken: result.claimToken })
    throw error
  }
}
