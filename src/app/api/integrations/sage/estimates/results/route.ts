import { and, eq, sql } from "drizzle-orm"

import { projectEstimates } from "@/db/schema-estimates"
import { sageEstimateExports } from "@/db/schema-sage"
import { recordActivityEvent } from "@/lib/activity-log"
import { updateEstimatesStatement } from "@/lib/domain/estimates/store"
import { finishEstimateExportSucceededStatement, updateSageEstimateExportsStatement } from "@/lib/domain/sage-bridge/estimate-store"
import { releaseSageResultLease, sageResultAlreadyRecorded, takeSageResultLease } from "@/lib/domain/sage-bridge/store"
import { readBoundedSageBridgeBody } from "@/lib/sage/bridge-auth"
import { authorizeSageChangeOrderBridge, ESTIMATE_WRITER } from "@/lib/sage/change-order-bridge"
import { sageExportActor } from "@/lib/sage/estimate-sync"
import { EDITED_WHILE_SENDING } from "@/lib/domain/sage-bridge/estimate-proposal-rules"
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
      claimedAt: sageEstimateExports.claimedAt,
    })
    .from(sageEstimateExports)
    .where(fence)
    .get()
  // An exact repeat of a result that already landed is answered as recorded:
  // the writer stops its whole run on any non-2xx answer.
  const staleOrRepeat = async (): Promise<Response> => {
    // A success may have been recorded as needs attention when the estimate was edited meanwhile.
    const recorded = result.outcome === "succeeded"
      ? (await sageResultAlreadyRecorded(db, "sage_estimate_exports", { id: result.id, organizationId, claimToken: result.claimToken, statuses: ["succeeded"] })) ??
        (await editedWhileSendingRecorded())
      : await sageResultAlreadyRecorded(db, "sage_estimate_exports", {
        id: result.id, organizationId, claimToken: result.claimToken, statuses: [result.needsAttention ? "needs_attention" : "failed"],
      })
    return recorded
      ? Response.json({ success: true, status: recorded, alreadyRecorded: true })
      : Response.json({ error: "Estimate claim changed" }, { status: 409 })
  }
  async function editedWhileSendingRecorded(): Promise<string | null> {
    const flagged = await sageResultAlreadyRecorded(db, "sage_estimate_exports", { id: result.id, organizationId, claimToken: result.claimToken, statuses: ["needs_attention"] })
    if (!flagged) return null
    const message = await db.select({ errorMessage: sageEstimateExports.errorMessage }).from(sageEstimateExports).where(eq(sageEstimateExports.id, result.id)).get()
    return message?.errorMessage === EDITED_WHILE_SENDING ? flagged : null
  }
  if (!row) return staleOrRepeat()
  // One handler per claim: a result posted twice applies (and logs, and queues the tax district) once.
  const leaseToken = await takeSageResultLease(db, "sage_estimate_exports", { id: result.id, organizationId, claimToken: result.claimToken, now: new Date().toISOString() })
  if (!leaseToken) return staleOrRepeat()
  // A throw while applying hands the lease back, so the claim is neither stuck nor half-applied.
  try {
    const leased = and(
      eq(sageEstimateExports.id, result.id),
      eq(sageEstimateExports.organizationId, organizationId),
      eq(sageEstimateExports.claimToken, leaseToken)
    )
    const now = new Date().toISOString()
    const estimateWhere = and(eq(projectEstimates.id, row.estimateId), eq(projectEstimates.projectId, row.projectId))
    // A success lands as needs attention when the estimate was edited after the
    // claim (decided inside the write: Sage has the older version; staff check
    // it, nothing re-sends it). A failure lands as reported.
    const exportWrite = result.outcome === "succeeded"
      ? finishEstimateExportSucceededStatement(db, {
        id: result.id, organizationId, leaseToken, claimedAt: row.claimedAt, editedMessage: EDITED_WHILE_SENDING, now,
      })
      : updateSageEstimateExportsStatement(db, leased, {
        status: result.needsAttention ? "needs_attention" : "failed", errorMessage: result.error, completedAt: now, updatedAt: now,
      }).returning({ id: sageEstimateExports.id, status: sageEstimateExports.status })
    const [updated] = await db.batch([
      exportWrite,
      // Only when the export update above landed under this lease; the estimate shows its outcome.
      updateEstimatesStatement(db, and(estimateWhere, sql`EXISTS (SELECT 1 FROM sage_estimate_exports
        WHERE id = ${result.id} AND claim_token = ${leaseToken} AND completed_at = ${now})`), {
        sageStatus: sql`(SELECT CASE status WHEN 'succeeded' THEN 'sent' ELSE status END FROM sage_estimate_exports WHERE id = ${result.id})`,
        ...(result.outcome === "succeeded" ? { lastSageSyncAt: now } : {}),
        updatedAt: now,
      }),
    ])
    if (updated.length !== 1) return Response.json({ error: "Estimate claim changed" }, { status: 409 })
    const status = updated[0]?.status ?? "succeeded"
    const edited = result.outcome === "succeeded" && status === "needs_attention"

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
          summary: `${estimate?.estimateNumber ?? "Estimate"}: ${row.automatic ? "synced to Sage automatically" : "sent to Sage"} (proposal ${result.proposalLineCount} lines, $${result.proposalTotal}${result.budgetLineCount === null ? "" : `; budget ${result.budgetLineCount} lines`}).${edited ? ` ${EDITED_WHILE_SENDING}` : ""}`,
          metadata: { proposalLineCount: result.proposalLineCount, proposalTotal: result.proposalTotal, budgetLineCount: result.budgetLineCount },
          createdAt: now,
        })
      }
    }
    return Response.json({ success: true, status }, { status: result.outcome === "succeeded" ? 200 : 202 })
  } catch (error) {
    await releaseSageResultLease(db, "sage_estimate_exports", { id: result.id, claimToken: result.claimToken })
    throw error
  }
}
