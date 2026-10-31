import { and, desc, eq, inArray, ne } from "drizzle-orm"
import type { getDb } from "@/db"
import {
  projectBudgetApplications,
  projectBudgetLines,
  projectChangeOrders,
  projectOperations,
} from "@/db/schema"
import { invoices, payments, vendorBills } from "@/db/schema-netsuite"
import {
  projectContractBudgetRevisions,
  projectEstimateLines,
  projectEstimates,
} from "@/db/schema-estimates"
import { preconstructionRebaselineBlockers } from "@/lib/change-orders/rebaseline"
import {
  insertChangeOrderHistoryStatement,
  updateChangeOrdersStatement,
  updateEstimatesStatement,
} from "@/lib/domain/estimates/store"
import { contractEstimateConditions } from "@/lib/estimates/estimate-family"
import { rebuildProjectContractBudget } from "@/lib/financials/contract-budget-store"

type Db = ReturnType<typeof getDb>
type BatchStatement = Parameters<Db["batch"]>[0][number]
type EstimateRow = typeof projectEstimates.$inferSelect

/**
 * Why a baseline replacement can't run yet, read from the project's live
 * records. The 0148/0243 trigger repeats these checks at write time.
 */
export async function rebaselineBlockers(
  db: Db,
  input: {
    readonly projectId: string
    readonly changeOrderId: string | null
    readonly ownerAudience: boolean
    readonly baseline: EstimateRow
    readonly replacement: EstimateRow
  }
): Promise<readonly string[]> {
  const [
    currentBaselineRows,
    replacementLines,
    budgetRows,
    applicationRows,
    purchaseOrderRows,
    billRows,
    invoiceRows,
    paymentRows,
    executedAdjustmentRows,
  ] = await Promise.all([
    db
      .select({ id: projectEstimates.id })
      .from(projectEstimates)
      .where(
        and(
          eq(projectEstimates.projectId, input.projectId),
          eq(projectEstimates.status, "accepted"),
          ...contractEstimateConditions()
        )
      )
      .orderBy(desc(projectEstimates.versionNumber))
      .limit(1),
    db
      .select({ id: projectEstimateLines.id })
      .from(projectEstimateLines)
      .where(eq(projectEstimateLines.estimateId, input.replacement.id))
      .limit(1),
    db
      .select({
        previousWorkCompleted: projectBudgetLines.previousWorkCompleted,
        currentWorkCompleted: projectBudgetLines.currentWorkCompleted,
        storedMaterials: projectBudgetLines.storedMaterials,
        priorCosts: projectBudgetLines.priorCosts,
        currentCosts: projectBudgetLines.currentCosts,
        totalCosts: projectBudgetLines.totalCosts,
      })
      .from(projectBudgetLines)
      .where(eq(projectBudgetLines.projectId, input.projectId)),
    db
      .select({ sourceSystem: projectBudgetApplications.sourceSystem })
      .from(projectBudgetApplications)
      .where(eq(projectBudgetApplications.projectId, input.projectId)),
    db
      .select({ status: projectOperations.status })
      .from(projectOperations)
      .where(
        and(
          eq(projectOperations.projectId, input.projectId),
          inArray(projectOperations.sourceRecordType, ["purchase_order", "google_nutech_order"])
        )
      ),
    db
      .select({ id: vendorBills.id })
      .from(vendorBills)
      .where(eq(vendorBills.projectId, input.projectId))
      .limit(1),
    // Preconstruction billing sits beside the construction contract.
    db
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.projectId, input.projectId), ne(invoices.billingScope, "preconstruction")))
      .limit(1),
    db
      .select({ id: payments.id })
      .from(payments)
      .where(and(eq(payments.projectId, input.projectId), ne(payments.billingScope, "preconstruction")))
      .limit(1),
    db
      .select({ id: projectChangeOrders.id })
      .from(projectChangeOrders)
      .where(
        and(
          eq(projectChangeOrders.projectId, input.projectId),
          ne(projectChangeOrders.id, input.changeOrderId ?? ""),
          eq(projectChangeOrders.budgetTreatment, "additive"),
          inArray(projectChangeOrders.status, ["executed", "sage_pending", "synced", "closed"])
        )
      )
      .limit(1),
  ])

  return preconstructionRebaselineBlockers({
    ownerAudience: input.ownerAudience,
    replacementEstimateFrozen: input.replacement.status === "signature_pending",
    replacementEstimateHasLines: replacementLines.length > 0,
    currentBaselineMatches: currentBaselineRows[0]?.id === input.baseline.id,
    hasActualCosts: budgetRows.some((row) =>
      [
        row.previousWorkCompleted,
        row.currentWorkCompleted,
        row.storedMaterials,
        row.priorCosts,
        row.currentCosts,
        row.totalCosts,
      ].some((amount) => amount !== 0)
    ),
    hasPurchaseOrders: purchaseOrderRows.some(
      (row) => !["void", "cancelled", "canceled"].includes(row.status.toLowerCase())
    ),
    hasVendorBills: billRows.length > 0,
    hasInvoicesOrPayments: invoiceRows.length > 0 || paymentRows.length > 0,
    hasPaymentApplications: applicationRows.some(
      (row) => row.sourceSystem !== "compass_contract_budget_projection"
    ),
    hasPriorExecutedAdjustments: executedAdjustmentRows.length > 0,
  })
}

export type ReplacementAcceptance = {
  readonly acceptanceMethod: string
  readonly acceptanceNote: string
  readonly evidenceUrl: string | null
  readonly evidenceLabel: string
  readonly signedAt: string
  readonly foxitStatus: string
}

/**
 * Executes a signature-pending baseline-replacement change order: the
 * replacement estimate is accepted, the old baseline superseded, and a new
 * contract budget built from the replacement goes live, all in one D1 batch
 * the database triggers can still abort.
 */
export async function executeBaselineReplacement(
  db: Db,
  input: {
    readonly projectId: string
    readonly changeOrder: {
      readonly id: string
      readonly changeOrderNumber: string
      readonly baselineEstimateId: string
      readonly replacementEstimateId: string
    }
    readonly actor: { readonly id: string; readonly name: string; readonly role: string }
    readonly acceptance: ReplacementAcceptance
    readonly note: string | null
    /** Run first in the same batch, e.g. inserting the change order itself. */
    readonly leadingStatements?: readonly BatchStatement[]
  }
): Promise<{ readonly success: true } | { readonly success: false; readonly error: string }> {
  const { projectId, changeOrder, actor, acceptance } = input
  const preparedBudget = await rebuildProjectContractBudget({
    db,
    projectId,
    actorUserId: actor.id,
    acceptedEstimateId: changeOrder.replacementEstimateId,
    publish: false,
  })
  if (!preparedBudget.success) {
    return { success: false, error: `The replacement budget could not be prepared: ${preparedBudget.error}` }
  }

  const now = new Date().toISOString()
  const projectionId = `contract-budget-view:${preparedBudget.revisionId}`
  const executionToken = crypto.randomUUID()
  const statements: BatchStatement[] = [
    ...(input.leadingStatements ?? []),
    updateChangeOrdersStatement(
      db,
      and(
        eq(projectChangeOrders.id, changeOrder.id),
        eq(projectChangeOrders.projectId, projectId),
        eq(projectChangeOrders.status, "signature_pending"),
        eq(projectChangeOrders.budgetTreatment, "baseline_replacement")
      ),
      { rebaselineExecutionToken: executionToken, updatedAt: now }
    ),
    updateEstimatesStatement(
      db,
      and(
        eq(projectEstimates.projectId, projectId),
        eq(projectEstimates.id, changeOrder.baselineEstimateId),
        eq(projectEstimates.status, "accepted")
      ),
      { status: "superseded", updatedAt: now }
    ),
    updateEstimatesStatement(
      db,
      and(
        eq(projectEstimates.id, changeOrder.replacementEstimateId),
        eq(projectEstimates.projectId, projectId),
        eq(projectEstimates.status, "signature_pending")
      ),
      {
        status: "accepted",
        foxitStatus: acceptance.foxitStatus,
        ...(acceptance.evidenceUrl ? { signaturePackageUrl: acceptance.evidenceUrl } : {}),
        signedAt: acceptance.signedAt,
        acceptanceMethod: acceptance.acceptanceMethod,
        acceptanceNote: acceptance.acceptanceNote,
        acceptanceEvidenceLabel: acceptance.evidenceLabel,
        acceptanceRecordedByName: actor.name,
        acceptedAt: now,
        acceptedBy: actor.id,
        sageStatus: "ready",
        updatedAt: now,
      }
    ),
    db
      .update(projectContractBudgetRevisions)
      .set({ status: "superseded" })
      .where(
        and(
          eq(projectContractBudgetRevisions.projectId, projectId),
          eq(projectContractBudgetRevisions.status, "current")
        )
      ),
    db
      .update(projectBudgetApplications)
      .set({ status: "budget_superseded", updatedAt: now })
      .where(
        and(
          eq(projectBudgetApplications.projectId, projectId),
          eq(projectBudgetApplications.status, "budget_current"),
          eq(projectBudgetApplications.sourceSystem, "compass_contract_budget_projection")
        )
      ),
    db
      .update(projectContractBudgetRevisions)
      .set({ status: "current" })
      .where(eq(projectContractBudgetRevisions.id, preparedBudget.revisionId)),
    db
      .update(projectBudgetApplications)
      .set({ status: "budget_current", ownerVisible: true, updatedAt: now })
      .where(eq(projectBudgetApplications.id, projectionId)),
    // Migration 0148 guards this status write against financial activity
    // created after the read-side eligibility check. Any blocker aborts the
    // entire D1 batch, including estimate and budget activation above.
    updateChangeOrdersStatement(
      db,
      and(
        eq(projectChangeOrders.id, changeOrder.id),
        eq(projectChangeOrders.projectId, projectId),
        eq(projectChangeOrders.status, "signature_pending"),
        eq(projectChangeOrders.rebaselineExecutionToken, executionToken)
      ),
      {
        status: "executed",
        executedAt: acceptance.signedAt,
        rebaselineCompletedAt: now,
        rebaselineCompletedBy: actor.id,
        foxitStatus: "completed",
        sageStatus: "not_applicable_rebaseline",
        ...(acceptance.evidenceUrl
          ? { executedDocumentUrl: acceptance.evidenceUrl, executedDocumentLabel: acceptance.evidenceLabel.slice(0, 200) }
          : {}),
        updatedAt: now,
      }
    ),
    insertChangeOrderHistoryStatement(db, {
      id: crypto.randomUUID(),
      projectId,
      changeOrderId: changeOrder.id,
      eventType: "baseline_replaced",
      fromStatus: "signature_pending",
      toStatus: "executed",
      actorUserId: actor.id,
      actorName: actor.name.slice(0, 200),
      actorRole: actor.role.slice(0, 80),
      note: input.note,
      metadataJson: JSON.stringify({
        budgetTreatment: "baseline_replacement",
        baselineEstimateId: changeOrder.baselineEstimateId,
        replacementEstimateId: changeOrder.replacementEstimateId,
        executionToken,
      }),
      createdAt: now,
    }),
  ]
  const [head, ...tail] = statements
  if (!head) return { success: false, error: "The replacement could not be prepared." }
  await db.batch([head, ...tail])
  return { success: true }
}
