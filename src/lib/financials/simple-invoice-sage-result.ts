import "server-only"

import { and, eq, isNull } from "drizzle-orm"
import type { z } from "zod/v4"

import { invoices } from "@/db/schema-netsuite"
import { sageInvoiceArExports } from "@/db/schema-sage"
import { simpleInvoiceUpdateStatement } from "@/lib/domain/financials/store"
import { recordActivityEvent } from "@/lib/activity-log"
import { updateSageInvoiceArExportsStatement } from "@/lib/domain/sage-bridge/ar-invoice-store"
import { releaseSageResultLease, takeSageResultLease } from "@/lib/domain/sage-bridge/store"
import { formatCents } from "@/lib/format"
import { sageAmountCents, type sageArInvoiceWriteResultSchema } from "@/lib/sage/ar-invoice-write"
import { sageExportActor } from "@/lib/sage/estimate-sync"
import type { Db } from "@/lib/server/action-context"

type WriteResult = z.infer<typeof sageArInvoiceWriteResultSchema>

function expectedTotalCents(payloadJson: string | null): number | null {
  if (!payloadJson) return null
  try {
    const parsed: unknown = JSON.parse(payloadJson)
    const invoice: unknown = typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "invoice") : null
    if (typeof invoice !== "object" || invoice === null) return null
    const lines: unknown = Reflect.get(invoice, "linesTotal")
    const tax: unknown = Reflect.get(invoice, "expectedSalesTax")
    return typeof lines === "string" && typeof tax === "string" ? sageAmountCents(lines) + sageAmountCents(tax) : null
  } catch {
    return null
  }
}

/**
 * The writer's result for a simple invoice's AR invoice (the result route
 * tries pay requests first). Returns null when the id/claim isn't a running
 * invoice export, so the route answers 409 as before.
 */
export async function applySimpleInvoiceSageResult(
  db: Db,
  organizationId: string,
  result: WriteResult
): Promise<{ readonly status: string; readonly httpStatus: 200 | 202 } | null> {
  const fence = and(
    eq(sageInvoiceArExports.id, result.id),
    eq(sageInvoiceArExports.organizationId, organizationId),
    eq(sageInvoiceArExports.status, "running"),
    eq(sageInvoiceArExports.claimToken, result.claimToken)
  )
  const row = await db
    .select({
      projectId: sageInvoiceArExports.projectId,
      invoiceId: sageInvoiceArExports.invoiceId,
      invoiceNumber: sageInvoiceArExports.invoiceNumber,
      requestedByUserId: sageInvoiceArExports.requestedByUserId,
      payloadJson: sageInvoiceArExports.payloadJson,
    })
    .from(sageInvoiceArExports)
    .where(fence)
    .get()
  if (!row) return null
  // One handler per claim: a result posted twice applies (and logs) once.
  const now = new Date().toISOString()
  const leaseToken = await takeSageResultLease(db, "sage_invoice_ar_exports", { id: result.id, organizationId, claimToken: result.claimToken, now })
  if (!leaseToken) return null
  const leased = and(eq(sageInvoiceArExports.id, result.id), eq(sageInvoiceArExports.organizationId, organizationId), eq(sageInvoiceArExports.claimToken, leaseToken))
  try {
    if (result.outcome === "failed") {
      const status = result.needsAttention ? "needs_attention" : "failed"
      const updated = await updateSageInvoiceArExportsStatement(db, leased, { status, errorMessage: result.error, completedAt: now, updatedAt: now }).returning({
        id: sageInvoiceArExports.id,
      })
      return updated.length === 1 ? { status, httpStatus: 202 } : null
    }
    // Sage computes the sales tax itself; a total that reads back differently
    // keeps the invoice (it is in Sage) but flags it for the office.
    const sageTotalCents = sageAmountCents(result.sageInvoiceTotal)
    const expected = expectedTotalCents(row.payloadJson)
    const differs = expected !== null && expected !== sageTotalCents
    const status = differs ? "needs_attention" : "succeeded"
    const updated = await updateSageInvoiceArExportsStatement(db, leased, {
      status,
      sageRecordId: result.sageRecordId,
      sageTotalCents,
      errorMessage:
        differs && expected !== null
          ? `Sage has invoice ${row.invoiceNumber}, but its total reads back as ${formatCents(sageTotalCents)} (sales tax ${formatCents(sageAmountCents(result.sageSalesTax))}); Compass expected ${formatCents(expected)}. Check it in Sage.`
          : null,
      completedAt: now,
      updatedAt: now,
    }).returning({ id: sageInvoiceArExports.id })
    if (updated.length !== 1) return null
    // The invoice now carries Sage's identity, so the Square webhook's payment
    // (keyed "sage-ar-invoice:<record>") applies to it rather than a copy.
    await simpleInvoiceUpdateStatement(db, and(eq(invoices.id, row.invoiceId), eq(invoices.organizationId, organizationId), isNull(invoices.sourceExternalId)), {
      sourceExternalId: `sage-ar-invoice:${result.sageRecordId}`,
      updatedAt: now,
    })
    const actor = await sageExportActor(db, row.requestedByUserId)
    if (actor) {
      await recordActivityEvent({
        db,
        organizationId,
        projectId: row.projectId,
        actor,
        category: "financial",
        action: "invoice_sage_added",
        entityType: "invoice",
        entityId: row.invoiceId,
        summary: `Invoice ${row.invoiceNumber}: ${result.alreadyInSage ? "already in Sage" : "added to Sage"} as an AR invoice (${formatCents(sageTotalCents)}).${differs ? " Sage's total differs; check it in Sage." : ""}`,
        metadata: { invoiceNumber: row.invoiceNumber, sageRecordId: result.sageRecordId, sageTotalCents, alreadyInSage: result.alreadyInSage },
        createdAt: now,
      })
    }
    return { status, httpStatus: 200 }
  } catch (error) {
    await releaseSageResultLease(db, "sage_invoice_ar_exports", { id: result.id, claimToken: result.claimToken })
    throw error
  }
}
