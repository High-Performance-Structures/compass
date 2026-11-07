import { and, asc, eq, isNotNull, lt, or } from "drizzle-orm"

import { projects } from "@/db/schema"
import { projectEstimates } from "@/db/schema-estimates"
import { sageEstimateExports } from "@/db/schema-sage"
import { updateEstimatesStatement } from "@/lib/domain/estimates/store"
import { claimSageEstimateExport, updateSageEstimateExportsStatement } from "@/lib/domain/sage-bridge/estimate-store"
import { sageBridgeBatchLimit, sageBridgeCutoff } from "@/lib/domain/sage-bridge/rules"
import { authorizeSageChangeOrderBridge, ESTIMATE_WRITER } from "@/lib/sage/change-order-bridge"
import { buildEstimateWriterRequest } from "@/lib/sage/estimate-sync"

const MAX_BATCH = 5
const CLAIM_RETRY_MILLISECONDS = 10 * 60 * 1000

/**
 * The Sage writer's poll for accepted estimates: claims queued ones, and ones
 * waiting for their job once Sage has it, each built from the estimate's
 * contract budget right now. A guard that fails here flags the estimate.
 */
export async function GET(request: Request): Promise<Response> {
  const bridge = await authorizeSageChangeOrderBridge(request, "", ESTIMATE_WRITER)
  if (!bridge.success) return bridge.response
  const { db, organizationId } = bridge
  const now = new Date()
  const nowIso = now.toISOString()
  const staleBefore = sageBridgeCutoff(now, CLAIM_RETRY_MILLISECONDS)
  const limit = sageBridgeBatchLimit(new URL(request.url).searchParams.get("limit"), 3, MAX_BATCH)
  const candidates = await db
    .select({ id: sageEstimateExports.id, projectId: sageEstimateExports.projectId, estimateId: sageEstimateExports.estimateId })
    .from(sageEstimateExports)
    .innerJoin(projects, eq(projects.id, sageEstimateExports.projectId))
    .where(
      and(
        eq(sageEstimateExports.organizationId, organizationId),
        or(
          eq(sageEstimateExports.status, "queued"),
          // Waiting rows are offered once Sage has the job.
          and(eq(sageEstimateExports.status, "waiting_for_job"), isNotNull(projects.sageJobNumber)),
          and(eq(sageEstimateExports.status, "running"), lt(sageEstimateExports.claimedAt, staleBefore))
        )
      )
    )
    .orderBy(asc(sageEstimateExports.requestedAt))
    .limit(limit)

  const requests: unknown[] = []
  // At most MAX_BATCH claims per poll, each fenced on its own row.
  for (const candidate of candidates) {
    const claimToken = crypto.randomUUID()
    if (!(await claimSageEstimateExport(db, { id: candidate.id, organizationId, claimToken, now: nowIso, staleBefore }))) continue
    const fence = and(eq(sageEstimateExports.id, candidate.id), eq(sageEstimateExports.claimToken, claimToken))
    const built = await buildEstimateWriterRequest(db, { organizationId, projectId: candidate.projectId, estimateId: candidate.estimateId })
    if (built.kind === "waiting") {
      await updateSageEstimateExportsStatement(db, fence, { status: "waiting_for_job", claimToken: null, updatedAt: nowIso })
      continue
    }
    if (built.kind === "needs_attention") {
      await db.batch([
        updateSageEstimateExportsStatement(db, fence, { status: "needs_attention", errorMessage: built.reason, completedAt: nowIso, updatedAt: nowIso }),
        updateEstimatesStatement(db, and(eq(projectEstimates.id, candidate.estimateId), eq(projectEstimates.projectId, candidate.projectId)), {
          sageStatus: "needs_attention",
          updatedAt: nowIso,
        }),
      ])
      continue
    }
    await updateSageEstimateExportsStatement(db, fence, { status: "running", payloadJson: JSON.stringify(built.payload), errorMessage: null, updatedAt: nowIso })
    requests.push({ id: candidate.id, claimToken, payload: built.payload })
  }
  return Response.json({ organizationId, requests })
}
