import { and, asc, eq, lt, or } from "drizzle-orm"

import { sageArInvoiceExports } from "@/db/schema-sage"
import { claimSageArInvoiceExport, updateSageArInvoiceExportsStatement } from "@/lib/domain/sage-bridge/ar-invoice-store"
import { sageBridgeBatchLimit, sageBridgeCutoff } from "@/lib/domain/sage-bridge/rules"
import { buildArInvoiceWriterRequest } from "@/lib/sage/ar-invoice-sync"
import { AR_INVOICE_WRITER, authorizeSageChangeOrderBridge } from "@/lib/sage/change-order-bridge"

const MAX_BATCH = 5
const CLAIM_RETRY_MILLISECONDS = 10 * 60 * 1000

/**
 * The Sage writer's poll for billed pay requests: claims queued AR invoices,
 * each built from the pay request right now. A guard that fails here flags
 * the pay request as needing attention instead of sending it.
 */
export async function GET(request: Request): Promise<Response> {
  const bridge = await authorizeSageChangeOrderBridge(request, "", AR_INVOICE_WRITER)
  if (!bridge.success) return bridge.response
  const { db, organizationId } = bridge
  const now = new Date()
  const nowIso = now.toISOString()
  const staleBefore = sageBridgeCutoff(now, CLAIM_RETRY_MILLISECONDS)
  const limit = sageBridgeBatchLimit(new URL(request.url).searchParams.get("limit"), 3, MAX_BATCH)
  const candidates = await db
    .select({
      id: sageArInvoiceExports.id,
      projectId: sageArInvoiceExports.projectId,
      applicationId: sageArInvoiceExports.applicationId,
      invoiceNumber: sageArInvoiceExports.invoiceNumber,
    })
    .from(sageArInvoiceExports)
    .where(
      and(
        eq(sageArInvoiceExports.organizationId, organizationId),
        or(
          eq(sageArInvoiceExports.status, "queued"),
          and(eq(sageArInvoiceExports.status, "running"), lt(sageArInvoiceExports.claimedAt, staleBefore))
        )
      )
    )
    .orderBy(asc(sageArInvoiceExports.requestedAt))
    .limit(limit)

  const requests: unknown[] = []
  // At most MAX_BATCH claims per poll, each fenced on its own row.
  for (const candidate of candidates) {
    const claimToken = crypto.randomUUID()
    if (!(await claimSageArInvoiceExport(db, { id: candidate.id, organizationId, claimToken, now: nowIso, staleBefore }))) continue
    const fence = and(eq(sageArInvoiceExports.id, candidate.id), eq(sageArInvoiceExports.claimToken, claimToken))
    const built = await buildArInvoiceWriterRequest(db, {
      organizationId,
      projectId: candidate.projectId,
      applicationId: candidate.applicationId,
      invoiceNumber: candidate.invoiceNumber,
    })
    if (built.kind === "needs_attention") {
      await updateSageArInvoiceExportsStatement(db, fence, {
        status: "needs_attention",
        claimToken: null,
        errorMessage: built.reason,
        completedAt: nowIso,
        updatedAt: nowIso,
      })
      continue
    }
    await updateSageArInvoiceExportsStatement(db, fence, { status: "running", payloadJson: JSON.stringify(built.payload), errorMessage: null, updatedAt: nowIso })
    requests.push({ id: candidate.id, claimToken, payload: built.payload })
  }
  return Response.json({ organizationId, requests })
}
