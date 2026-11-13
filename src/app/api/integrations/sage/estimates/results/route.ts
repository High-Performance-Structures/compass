import { and, eq, sql } from "drizzle-orm"

import { projectEstimates } from "@/db/schema-estimates"
import { sageEstimateExports } from "@/db/schema-sage"
import { recordActivityEvent } from "@/lib/activity-log"
import { updateEstimatesStatement } from "@/lib/domain/estimates/store"
import { updateSageEstimateExportsStatement } from "@/lib/domain/sage-bridge/estimate-store"
import { sageResultAlreadyRecorded, takeSageResultLease } from "@/lib/domain/sage-bridge/store"
import { readBoundedSageBridgeBody } from "@/lib/sage/bridge-auth"
import { authorizeSageChangeOrderBridge, ESTIMATE_WRITER } from "@/lib/sage/change-order-bridge"
import { sageExportActor } from "@/lib/sage/estimate-sync"
import { sageEstimateWriteResultSchema } from "@/lib/sage/estimate-write"
import { queueSageJobTaxDistrict } from "@/lib/sage/job-tax-district"

/** The Sage writer reports an accepted estimate: proposal (and budget) added, or why not. */
export async function POST(request: Request): Promise<Response> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "Content-Type must be application/json" }, { status: 415 })
  }
  const body = await readBoundedSageBridgeBody(request)
  if (!body.success) return Response.json({ error: body.error }, { status: 413 })
  const bridge = await authorizeSageChangeOrderBridge(request, body.rawBody, ESTIMATE_WRITER)
  if (!bridge.success) return bridge.response
  let raw: unknown
  try {
    raw = JSON.parse(body.rawBody)
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = sageEstimateWriteResultSchema.safeParse(raw)
  if (!parsed.success) return Response.json({ error: "Invalid estimate result" }, { status: 400 })
  const result = parsed.data
  const { db, organizationId } = bridge
  const fence = and(
    eq(sageEstimateExports.id, result.id),
    eq(sageEstimateExports.organizationId, organizationId),
    eq(sageEstimateExports.status, "running"),
    eq(sageEstimateExports.claimToken, result.claimToken)
  )
  const row = await db
    .select({
      projectId: sageEstimateExports.projectId,
      estimateId: sageEstimateExports.estimateId,
      requestedByUserId: sageEstimateExports.requestedByUserId,
      automatic: sageEstimateExports.automatic,
    })
    .from(sageEstimateExports)
    .where(fence)
    .get()
  // An exact repeat of a result that already landed is answered as recorded:
  // the writer stops its whole run on any non-2xx answer.
  const staleOrRepeat = async (): Promise<Response> => {
    const recorded = await sageResultAlreadyRecorded(db, "sage_estimate_exports", {
      id: result.id, organizationId, claimToken: result.claimToken, statuses: result.outcome === "succeeded" ? ["succeeded"] : ["failed", "needs_attention"],
    })
    return recorded
      ? Response.json({ success: true, status: recorded, alreadyRecorded: true })
      : Response.json({ error: "Estimate claim changed" }, { status: 409 })
  }
  if (!row) return staleOrRepeat()
  // One handler per claim: a result posted twice applies (and logs, and queues the tax district) once.
  const leaseToken = await takeSageResultLease(db, "sage_estimate_exports", { id: result.id, organizationId, claimToken: result.claimToken })
  if (!leaseToken) return staleOrRepeat()
  const leased = and(
    eq(sageEstimateExports.id, result.id),
    eq(sageEstimateExports.organizationId, organizationId),
    eq(sageEstimateExports.claimToken, leaseToken)
  )
  const now = new Date().toISOString()
  const status = result.outcome === "succeeded" ? "succeeded" : result.needsAttention ? "needs_attention" : "failed"
  const estimateWhere = and(eq(projectEstimates.id, row.estimateId), eq(projectEstimates.projectId, row.projectId))
  const [updated] = await db.batch([
    updateSageEstimateExportsStatement(db, leased, {
      status,
      errorMessage: result.outcome === "failed" ? result.error : null,
      completedAt: now,
      updatedAt: now,
    }).returning({ id: sageEstimateExports.id }),
    // Only when the export update above landed under this lease.
    updateEstimatesStatement(db, and(estimateWhere, sql`EXISTS (SELECT 1 FROM sage_estimate_exports
      WHERE id = ${result.id} AND claim_token = ${leaseToken} AND status = ${status} AND completed_at = ${now})`), {
      sageStatus: status === "succeeded" ? "sent" : status,
      ...(status === "succeeded" ? { lastSageSyncAt: now } : {}),
      updatedAt: now,
    }),
  ])
  if (updated.length !== 1) return Response.json({ error: "Estimate claim changed" }, { status: 409 })

  if (result.outcome === "succeeded") {
    // The job now carries the accepted estimate, so give it the estimate's tax
    // district for Progress Billing. Best effort: the proposal result stands.
    try {
      await queueSageJobTaxDistrict(db, {
        organizationId, projectId: row.projectId, estimateId: row.estimateId,
        requestedByUserId: row.requestedByUserId, now,
      })
    } catch (error) {
      console.error("Sage job tax district could not be queued", error)
    }
    const [actor, estimate] = await Promise.all([
      sageExportActor(db, row.requestedByUserId),
      db.select({ estimateNumber: projectEstimates.estimateNumber }).from(projectEstimates).where(estimateWhere).get(),
    ])
    if (actor) {
      await recordActivityEvent({
        db,
        organizationId,
        projectId: row.projectId,
        actor,
        category: "financial",
        action: "estimate_synced_to_sage",
        entityType: "project_estimate",
        entityId: row.estimateId,
        summary: `${estimate?.estimateNumber ?? "Estimate"}: ${row.automatic ? "synced to Sage automatically" : "sent to Sage"} (proposal ${result.proposalLineCount} lines, $${result.proposalTotal}${result.budgetLineCount === null ? "" : `; budget ${result.budgetLineCount} lines`}).`,
        metadata: { proposalLineCount: result.proposalLineCount, proposalTotal: result.proposalTotal, budgetLineCount: result.budgetLineCount },
        createdAt: now,
      })
    }
  }
  return Response.json({ success: true, status }, { status: result.outcome === "succeeded" ? 200 : 202 })
}
