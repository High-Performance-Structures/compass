/*
 * Sending a Compass draw (owner pay application) for review and back
 * (issue #1329). "Ready for review" freezes the draw, recomputes its totals
 * and snapshots its G702/G703 for the Sage review on its workflow item in
 * one compare-and-set batch, so the snapshot can't miss a line edit made
 * while it ran (line edits land only on drafts; see store.ts). Callers check
 * access first.
 */
import { and, asc, eq } from "drizzle-orm"

import { projectBudgetApplications, projectBudgetLines, projectOperations } from "@/db/schema"
import { budgetLinesUnchanged, movePayApplicationStatus, readBudgetLinesSignature } from "@/lib/domain/budget/store"
import { operationUpdateQuery, updateOperations } from "@/lib/domain/operations/store"
import { ownerPayApplicationTotals } from "@/lib/financials/owner-pay-application-refresh"
import { g703ByCostCode } from "@/lib/financials/pay-application-shares"
import type { Db } from "@/lib/server/action-context"

type DrawRef = { readonly projectId: string; readonly applicationId: string; readonly now: string }

type ApplicationRow = typeof projectBudgetApplications.$inferSelect
type LineRow = typeof projectBudgetLines.$inferSelect

/** The G702/G703 snapshot staged on the workflow item for the Sage review. */
function sageReviewPayload(application: ApplicationRow, lines: readonly LineRow[]): string {
  const applicationId = application.id
  return JSON.stringify({
    schemaVersion: 1,
    source: "compass_owner_pay_application",
    writeApprovalRequired: true,
    applicationId,
    applicationNumber: application.applicationNumber,
    periodTo: application.periodTo,
    budgetRevisionId: application.budgetRevisionId,
    g702: {
      originalContractSum: application.originalContractSum,
      netChanges: application.netChanges,
      contractSumToDate: application.contractSumToDate,
      totalCompletedStoredToDate: application.totalCompletedStoredToDate,
      retainageHeld: application.retainageHeld,
      totalEarnedLessRetainage: application.totalEarnedLessRetainage,
      previousCertificates: application.previousCertificates,
      depositApplied: application.depositApplied,
      currentPaymentDue: application.currentPaymentDue,
      balanceToFinish: application.balanceToFinish,
    },
    // Sage keeps one G703 line per cost code; assembly detail travels alongside.
    g703: g703ByCostCode(lines).map((line) => ({
      budgetRevisionLineId: line.budgetRevisionLineId,
      divisionCode: line.csiDivision,
      costCode: line.costCode,
      description: line.description,
      originalEstimate: line.originalEstimate,
      totalChanges: line.totalChanges,
      adjustedEstimate: line.adjustedEstimate,
      previousWorkCompleted: line.previousWorkCompleted,
      currentWorkCompleted: line.currentWorkCompleted,
      storedMaterials: line.storedMaterials,
      totalCompletedStored: line.totalCosts,
      retainageHeld: line.retainageHeld,
      balanceToFinish: line.balanceToFinish,
    })),
    g703Assemblies: lines.map((line) => ({
      sourceLineId: line.id,
      costCode: line.costCode,
      assemblyKey: line.assemblyKey,
      assemblyName: line.assemblyName,
      adjustedEstimate: line.adjustedEstimate,
      currentWorkCompleted: line.currentWorkCompleted,
      storedMaterials: line.storedMaterials,
      totalCompletedStored: line.totalCosts,
    })),
  })
}

async function orderedLines(db: Db, applicationId: string): Promise<LineRow[]> {
  return db
    .select()
    .from(projectBudgetLines)
    .where(eq(projectBudgetLines.applicationId, applicationId))
    .orderBy(asc(projectBudgetLines.csiDivision), asc(projectBudgetLines.sortOrder))
}

function workflowItem(projectId: string, applicationId: string) {
  return and(eq(projectOperations.projectId, projectId), eq(projectOperations.sourceRecordId, applicationId))
}

/**
 * mark_ready: freezes a draft and stages its Sage review snapshot, in one
 * batch: the move, the totals recomputed from its lines, and the workflow
 * item. It lands only if the lines and the draw are still as read (no edit
 * slipped in). Throws a message for staff when it can't.
 */
export async function sendPayApplicationForReview(db: Db, { projectId, applicationId, now }: DrawRef): Promise<void> {
  // Read first: an edit landing while the rest is read then fails the guard.
  const signature = await readBudgetLinesSignature(db, applicationId)
  const draft = await db
    .select()
    .from(projectBudgetApplications)
    .where(
      and(
        eq(projectBudgetApplications.id, applicationId),
        eq(projectBudgetApplications.projectId, projectId),
        eq(projectBudgetApplications.status, "draft")
      )
    )
    .get()
  if (!draft) throw new Error("Draft pay application not found.")
  const lines = await orderedLines(db, applicationId)
  if (lines.length === 0) throw new Error("The pay application has no G703 lines.")
  const totals = await ownerPayApplicationTotals(db, projectId, applicationId)
  // A draw fully covered by the deposit still needs review and entry.
  if (totals.currentPaymentDue <= 0 && totals.depositApplied <= 0) {
    throw new Error("Enter current work or stored materials before Sage review.")
  }
  const frozen = { ...draft, ...totals }
  const moved = await movePayApplicationStatus(db, {
    projectId,
    applicationId,
    event: "mark_ready",
    also: and(budgetLinesUnchanged(applicationId, signature), eq(projectBudgetApplications.updatedAt, draft.updatedAt)),
    values: { ...totals, syncStatus: "needs_review", updatedAt: now },
    alongWith: [
      operationUpdateQuery(db, workflowItem(projectId, applicationId), {
        status: "internal_review",
        amount: totals.currentPaymentDue,
        sageWriteStatus: "draft_ready",
        sagePayloadJson: sageReviewPayload(frozen, lines),
        syncStatus: "needs_review",
        updatedAt: now,
      }),
    ],
  })
  if (!moved) throw new Error("This pay application changed or was already sent for review. Refresh to see where it stands.")
}

/**
 * Re-stages the Sage review snapshot of a draw in review after its amounts
 * changed (Sage's amounts were applied). Nothing for a draft.
 */
export async function restagePayApplicationReview(db: Db, { projectId, applicationId, now }: DrawRef): Promise<void> {
  const application = await db
    .select()
    .from(projectBudgetApplications)
    .where(and(eq(projectBudgetApplications.id, applicationId), eq(projectBudgetApplications.status, "internal_review")))
    .get()
  if (!application) return
  await updateOperations(db, workflowItem(projectId, applicationId), {
    amount: application.currentPaymentDue,
    sagePayloadJson: sageReviewPayload(application, await orderedLines(db, applicationId)),
    updatedAt: now,
  })
}

/** return_to_draft: a draw in review goes back to an editable draft. Throws a message for staff when it can't. */
export async function returnPayApplicationToDraft(db: Db, { projectId, applicationId, now }: DrawRef): Promise<void> {
  const application = await db
    .select({ id: projectBudgetApplications.id })
    .from(projectBudgetApplications)
    .where(
      and(
        eq(projectBudgetApplications.id, applicationId),
        eq(projectBudgetApplications.projectId, projectId),
        eq(projectBudgetApplications.sourceSystem, "compass_contract_budget"),
        eq(projectBudgetApplications.status, "internal_review")
      )
    )
    .get()
  if (!application) throw new Error("Only a pay application in internal review can go back to draft.")
  const moved = await movePayApplicationStatus(db, {
    projectId,
    applicationId,
    event: "return_to_draft",
    values: { syncStatus: "compass_only", updatedAt: now },
    alongWith: [
      operationUpdateQuery(
        db,
        and(
          eq(projectOperations.projectId, projectId),
          eq(projectOperations.sourceRecordType, "owner_pay_application"),
          eq(projectOperations.sourceRecordId, applicationId)
        ),
        { status: "draft", syncStatus: "compass_only", updatedAt: now }
      ),
    ],
  })
  if (!moved) throw new Error("Only a pay application in internal review can go back to draft.")
}
