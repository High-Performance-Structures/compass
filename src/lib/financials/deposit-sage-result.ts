import "server-only"

import { and, eq } from "drizzle-orm"
import type { z } from "zod/v4"

import { sageDepositArExports } from "@/db/schema-sage"
import { recordActivityEvent } from "@/lib/activity-log"
import { updateSageDepositArExportsStatement } from "@/lib/domain/sage-bridge/ar-invoice-store"
import { formatCents } from "@/lib/format"
import { sageAmountCents, type sageArInvoiceWriteResultSchema } from "@/lib/sage/ar-invoice-write"
import { sageExportActor } from "@/lib/sage/estimate-sync"
import type { Db } from "@/lib/server/action-context"

type WriteResult = z.infer<typeof sageArInvoiceWriteResultSchema>

/** The lines total Compass sent (a deposit is never taxed). */
function sentTotalCents(payloadJson: string | null): number | null {
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
 * The writer's result for a deposit request's AR invoice (the result route
 * tries pay requests, then simple invoices, then deposits). Null when the
 * id/claim isn't a running deposit export, so the route answers 409.
 */
export async function applyDepositSageResult(
  db: Db,
  organizationId: string,
  result: WriteResult
): Promise<{ readonly status: string; readonly httpStatus: 200 | 202 } | null> {
  const fence = and(
    eq(sageDepositArExports.id, result.id),
    eq(sageDepositArExports.organizationId, organizationId),
    eq(sageDepositArExports.status, "running"),
    eq(sageDepositArExports.claimToken, result.claimToken)
  )
  const row = await db
    .select({
      projectId: sageDepositArExports.projectId,
      depositId: sageDepositArExports.depositId,
      invoiceNumber: sageDepositArExports.invoiceNumber,
      requestedByUserId: sageDepositArExports.requestedByUserId,
      payloadJson: sageDepositArExports.payloadJson,
    })
    .from(sageDepositArExports)
    .where(fence)
    .get()
  if (!row) return null
  const now = new Date().toISOString()
  if (result.outcome === "failed") {
    const status = result.needsAttention ? "needs_attention" : "failed"
    const updated = await updateSageDepositArExportsStatement(db, fence, { status, errorMessage: result.error, completedAt: now, updatedAt: now }).returning({
      id: sageDepositArExports.id,
    })
    return updated.length === 1 ? { status, httpStatus: 202 } : null
  }
  const sageTotalCents = sageAmountCents(result.sageInvoiceTotal)
  const expected = sentTotalCents(row.payloadJson)
  const differs = expected !== null && expected !== sageTotalCents
  const status = differs ? "needs_attention" : "succeeded"
  const updated = await updateSageDepositArExportsStatement(db, fence, {
    status,
    sageRecordId: result.sageRecordId,
    sageTotalCents,
    errorMessage:
      differs && expected !== null
        ? `Sage has invoice ${row.invoiceNumber}, but its total reads back as ${formatCents(sageTotalCents)}; Compass expected ${formatCents(expected)}. Check it in Sage.`
        : null,
    completedAt: now,
    updatedAt: now,
  }).returning({ id: sageDepositArExports.id })
  if (updated.length !== 1) return null
  const actor = await sageExportActor(db, row.requestedByUserId)
  if (actor) {
    await recordActivityEvent({
      db,
      organizationId,
      projectId: row.projectId,
      actor,
      category: "financial",
      action: "deposit_sage_added",
      entityType: "project_contract_deposit",
      entityId: row.depositId,
      summary: `Deposit request ${row.invoiceNumber}: ${result.alreadyInSage ? "already in Sage" : "added to Sage"} as an AR invoice (${formatCents(sageTotalCents)}).${differs ? " Sage's total differs; check it in Sage." : ""}`,
      metadata: { invoiceNumber: row.invoiceNumber, sageRecordId: result.sageRecordId, sageTotalCents, alreadyInSage: result.alreadyInSage },
      createdAt: now,
    })
  }
  return { status, httpStatus: 200 }
}
