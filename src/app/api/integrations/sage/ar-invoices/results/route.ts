import { and, eq, sql } from "drizzle-orm"
import { z } from "zod/v4"

import { projectBudgetApplications, projectOperations } from "@/db/schema"
import { sageArInvoiceExports } from "@/db/schema-sage"
import { recordActivityEvent } from "@/lib/activity-log"
import { updateBudgetApplicationsStatement } from "@/lib/domain/budget/store"
import { operationUpdateQuery } from "@/lib/domain/operations/store"
import { updateSageArInvoiceExportsStatement } from "@/lib/domain/sage-bridge/ar-invoice-store"
import { sageResultAlreadyRecorded, takeSageResultLease } from "@/lib/domain/sage-bridge/store"
import { applyDepositSageResult } from "@/lib/financials/deposit-sage-result"
import { applySimpleInvoiceSageResult } from "@/lib/financials/simple-invoice-sage-result"
import { formatCents } from "@/lib/format"
import { readBoundedSageBridgeBody } from "@/lib/sage/bridge-auth"
import { sageArInvoiceWriteResultSchema, sageAmountCents } from "@/lib/sage/ar-invoice-write"
import { AR_INVOICE_WRITER, authorizeSageChangeOrderBridge } from "@/lib/sage/change-order-bridge"
import { sageExportActor } from "@/lib/sage/estimate-sync"

const SENT_TOTALS = z.object({ invoice: z.object({ linesTotal: z.string(), expectedSalesTax: z.string() }) })

/** The total Compass expected Sage to read back (lines plus sales tax), from the payload it sent. */
function expectedTotalCents(payloadJson: string | null): number | null {
  if (!payloadJson) return null
  try {
    const sent = SENT_TOTALS.safeParse(JSON.parse(payloadJson))
    return sent.success ? sageAmountCents(sent.data.invoice.linesTotal) + sageAmountCents(sent.data.invoice.expectedSalesTax) : null
  } catch {
    return null
  }
}

/**
 * The Sage writer reports a pay request's (or simple invoice's) AR invoice:
 * added (or already in Sage), or why not. On success the pay request records the Sage invoice
 * number, as when staff entered it by hand.
 */
export async function POST(request: Request): Promise<Response> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "Content-Type must be application/json" }, { status: 415 })
  }
  const body = await readBoundedSageBridgeBody(request)
  if (!body.success) return Response.json({ error: body.error }, { status: 413 })
  const bridge = await authorizeSageChangeOrderBridge(request, body.rawBody, AR_INVOICE_WRITER)
  if (!bridge.success) return bridge.response
  let raw: unknown
  try {
    raw = JSON.parse(body.rawBody)
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = sageArInvoiceWriteResultSchema.safeParse(raw)
  if (!parsed.success) return Response.json({ error: "Invalid AR invoice result" }, { status: 400 })
  const result = parsed.data
  const { db, organizationId } = bridge
  const fence = and(
    eq(sageArInvoiceExports.id, result.id),
    eq(sageArInvoiceExports.organizationId, organizationId),
    eq(sageArInvoiceExports.status, "running"),
    eq(sageArInvoiceExports.claimToken, result.claimToken)
  )
  const row = await db
    .select({
      projectId: sageArInvoiceExports.projectId,
      applicationId: sageArInvoiceExports.applicationId,
      invoiceNumber: sageArInvoiceExports.invoiceNumber,
      requestedByUserId: sageArInvoiceExports.requestedByUserId,
      automatic: sageArInvoiceExports.automatic,
      payloadJson: sageArInvoiceExports.payloadJson,
    })
    .from(sageArInvoiceExports)
    .where(fence)
    .get()
  // An exact repeat of a result that already landed is answered as recorded:
  // the writer stops its whole run on any non-2xx answer.
  const staleOrRepeat = async (): Promise<Response> => {
    const recorded = await sageResultAlreadyRecorded(db, "sage_ar_invoice_exports", {
      id: result.id, organizationId, claimToken: result.claimToken,
      statuses: result.outcome === "succeeded" ? ["succeeded", "needs_attention"] : ["failed", "needs_attention"],
    })
    return recorded
      ? Response.json({ success: true, status: recorded, alreadyRecorded: true })
      : Response.json({ error: "AR invoice claim changed" }, { status: 409 })
  }
  if (!row) {
    // Not a pay request's export: a simple Compass invoice's, a deposit request's, or a stale claim.
    const invoiceResult = (await applySimpleInvoiceSageResult(db, organizationId, result)) ?? (await applyDepositSageResult(db, organizationId, result))
    if (!invoiceResult) return staleOrRepeat()
    return Response.json({ success: true, status: invoiceResult.status }, { status: invoiceResult.httpStatus })
  }
  // One handler per claim: a result posted twice records the invoice number and logs once.
  const leaseToken = await takeSageResultLease(db, "sage_ar_invoice_exports", { id: result.id, organizationId, claimToken: result.claimToken })
  if (!leaseToken) return staleOrRepeat()
  const leased = and(
    eq(sageArInvoiceExports.id, result.id),
    eq(sageArInvoiceExports.organizationId, organizationId),
    eq(sageArInvoiceExports.claimToken, leaseToken)
  )
  const now = new Date().toISOString()

  if (result.outcome === "failed") {
    const status = result.needsAttention ? "needs_attention" : "failed"
    const [updated] = await db.batch([
      updateSageArInvoiceExportsStatement(db, leased, { status, errorMessage: result.error, completedAt: now, updatedAt: now }).returning({ id: sageArInvoiceExports.id }),
    ])
    if (updated.length !== 1) return Response.json({ error: "AR invoice claim changed" }, { status: 409 })
    return Response.json({ success: true, status }, { status: 202 })
  }

  // Sage computes the sales tax itself; a total that reads back differently
  // keeps the invoice (it is in Sage) but flags it for the office.
  const sageTotalCents = sageAmountCents(result.sageInvoiceTotal)
  const expected = expectedTotalCents(row.payloadJson)
  const differs = expected !== null && expected !== sageTotalCents
  const status = differs ? "needs_attention" : "succeeded"
  const applicationWhere = and(eq(projectBudgetApplications.id, row.applicationId), eq(projectBudgetApplications.projectId, row.projectId))
  // The pay request and its operation take the invoice number only when the export update landed under this lease.
  const exportLanded = sql`EXISTS (SELECT 1 FROM sage_ar_invoice_exports
    WHERE id = ${result.id} AND claim_token = ${leaseToken} AND status = ${status} AND completed_at = ${now})`
  const [updated] = await db.batch([
    updateSageArInvoiceExportsStatement(db, leased, {
      status,
      sageRecordId: result.sageRecordId,
      sageTotalCents,
      errorMessage: differs && expected !== null
        ? `Sage has invoice ${row.invoiceNumber}, but its total reads back as ${formatCents(sageTotalCents)} (sales tax ${formatCents(sageAmountCents(result.sageSalesTax))}); Compass expected ${formatCents(expected)}. Check it in Sage before posting.`
        : null,
      completedAt: now,
      updatedAt: now,
    }).returning({ id: sageArInvoiceExports.id }),
    updateBudgetApplicationsStatement(db, and(applicationWhere, exportLanded), { sageInvoiceNumber: row.invoiceNumber, syncStatus: "synced", updatedAt: now }),
    operationUpdateQuery(
      db,
      and(
        eq(projectOperations.projectId, row.projectId),
        eq(projectOperations.sourceRecordType, "owner_pay_application"),
        eq(projectOperations.sourceRecordId, row.applicationId),
        exportLanded
      ),
      { syncStatus: "synced", updatedAt: now }
    ),
  ])
  if (updated.length !== 1) return Response.json({ error: "AR invoice claim changed" }, { status: 409 })

  const [actor, application] = await Promise.all([
    sageExportActor(db, row.requestedByUserId),
    db.select({ applicationNumber: projectBudgetApplications.applicationNumber }).from(projectBudgetApplications).where(applicationWhere).get(),
  ])
  if (actor) {
    await recordActivityEvent({
      db,
      organizationId,
      projectId: row.projectId,
      actor,
      category: "financial",
      action: "pay_application_sage_invoice_added",
      entityType: "project_budget_application",
      entityId: row.applicationId,
      summary: `Pay application ${application?.applicationNumber ?? ""}: ${result.alreadyInSage ? "already in Sage" : "added to Sage"} as AR invoice ${row.invoiceNumber} (${formatCents(sageTotalCents)}).${differs ? " Sage's total differs; check it before posting." : ""}`,
      metadata: { invoiceNumber: row.invoiceNumber, sageRecordId: result.sageRecordId, sageTotalCents, alreadyInSage: result.alreadyInSage, automatic: row.automatic },
      createdAt: now,
    })
  }
  return Response.json({ success: true, status })
}
