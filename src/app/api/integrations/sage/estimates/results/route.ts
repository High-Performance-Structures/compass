import { and, eq } from "drizzle-orm"

import { projectEstimates } from "@/db/schema-estimates"
import { sageEstimateExports } from "@/db/schema-sage"
import { recordActivityEvent } from "@/lib/activity-log"
import { updateEstimatesStatement } from "@/lib/domain/estimates/store"
import { updateSageEstimateExportsStatement } from "@/lib/domain/sage-bridge/estimate-store"
import { readBoundedSageBridgeBody } from "@/lib/sage/bridge-auth"
import { authorizeSageChangeOrderBridge, ESTIMATE_WRITER } from "@/lib/sage/change-order-bridge"
import { sageExportActor } from "@/lib/sage/estimate-sync"
import { sageEstimateWriteResultSchema } from "@/lib/sage/estimate-write"

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
  if (!row) return Response.json({ error: "Estimate claim changed" }, { status: 409 })
  const now = new Date().toISOString()
  const status = result.outcome === "succeeded" ? "succeeded" : result.needsAttention ? "needs_attention" : "failed"
  const estimateWhere = and(eq(projectEstimates.id, row.estimateId), eq(projectEstimates.projectId, row.projectId))
  const [updated] = await db.batch([
    updateSageEstimateExportsStatement(db, fence, {
      status,
      errorMessage: result.outcome === "failed" ? result.error : null,
      completedAt: now,
      updatedAt: now,
    }).returning({ id: sageEstimateExports.id }),
    updateEstimatesStatement(db, estimateWhere, {
      sageStatus: status === "succeeded" ? "sent" : status,
      ...(status === "succeeded" ? { lastSageSyncAt: now } : {}),
      updatedAt: now,
    }),
  ])
  if (updated.length !== 1) return Response.json({ error: "Estimate claim changed" }, { status: 409 })

  if (result.outcome === "succeeded") {
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
