import { and, eq, ne, notInArray, sql } from "drizzle-orm"

import type { getDb } from "@/db"
import {
  projectBudgetApplications,
  projectBudgetLines,
  projectContractDeposits,
  projectOperations,
} from "@/db/schema"
import {
  currentPaymentDueAfterDeposit,
  depositAppliedToDraw,
  drawAmountBeforeDeposit,
  unappliedDeposit,
} from "@/lib/financials/contract-deposits"

/** Pay applications that can carry an applied deposit (not projections). */
const DEPOSIT_EXCLUDED_APPLICATION_STATUSES = ["budget_current", "budget_superseded", "void"] as const

/**
 * Deposit received on the project and not applied to any other pay
 * application, in dollars.
 */
export async function availableDepositForApplication(
  db: ReturnType<typeof getDb>,
  projectId: string,
  applicationId: string
): Promise<number> {
  const [received, applied] = await Promise.all([
    db
      .select({ cents: sql<number>`coalesce(sum(${projectContractDeposits.receivedAmountCents}), 0)` })
      .from(projectContractDeposits)
      .where(and(eq(projectContractDeposits.projectId, projectId), eq(projectContractDeposits.status, "received")))
      .get(),
    db
      .select({ dollars: sql<number>`coalesce(sum(${projectBudgetApplications.depositApplied}), 0)` })
      .from(projectBudgetApplications)
      .where(
        and(
          eq(projectBudgetApplications.projectId, projectId),
          ne(projectBudgetApplications.id, applicationId),
          notInArray(projectBudgetApplications.status, [...DEPOSIT_EXCLUDED_APPLICATION_STATUSES])
        )
      )
      .get(),
  ])
  return unappliedDeposit({ receivedCents: Number(received?.cents ?? 0), appliedDollars: Number(applied?.dollars ?? 0) })
}

export async function refreshOwnerPayApplication(
  db: ReturnType<typeof getDb>,
  projectId: string,
  applicationId: string,
  now: string
): Promise<void> {
  const applicationRows = await db
    .select()
    .from(projectBudgetApplications)
    .where(eq(projectBudgetApplications.id, applicationId))
    .limit(1)
  const application = applicationRows[0]
  if (!application) throw new Error("Pay application not found.")
  const lines = await db
    .select()
    .from(projectBudgetLines)
    .where(eq(projectBudgetLines.applicationId, applicationId))
  const totalCompletedStoredToDate = lines.reduce(
    (sum, line) => sum + line.totalCosts,
    0
  )
  const retainageHeld = lines.reduce(
    (sum, line) => sum + line.retainageHeld,
    0
  )
  const totalEarnedLessRetainage =
    Math.round((totalCompletedStoredToDate - retainageHeld) * 100) / 100
  // A deposit received on the contract is applied before the client pays.
  const depositApplied = depositAppliedToDraw({
    mode: application.depositAppliedMode === "manual" ? "manual" : "auto",
    requested: application.depositApplied,
    availableDeposit: await availableDepositForApplication(db, projectId, applicationId),
    drawBeforeDeposit: drawAmountBeforeDeposit({
      totalEarnedLessRetainage,
      previousCertificates: application.previousCertificates,
    }),
  })
  const currentPaymentDue = currentPaymentDueAfterDeposit({
    totalEarnedLessRetainage,
    previousCertificates: application.previousCertificates,
    depositApplied,
  })
  const balanceToFinish =
    Math.round(
      (application.contractSumToDate - totalEarnedLessRetainage) * 100
    ) / 100
  await db
    .update(projectBudgetApplications)
    .set({
      totalCompletedStoredToDate,
      retainageHeld,
      totalEarnedLessRetainage,
      depositApplied,
      currentPaymentDue,
      balanceToFinish,
      updatedAt: now,
    })
    .where(eq(projectBudgetApplications.id, applicationId))
    .run()
  await db
    .update(projectOperations)
    .set({ amount: currentPaymentDue, updatedAt: now })
    .where(
      and(
        eq(projectOperations.projectId, projectId),
        eq(projectOperations.sourceRecordId, applicationId)
      )
    )
    .run()
}


/**
 * Recalculate draft pay applications that apply the deposit automatically,
 * after a deposit is recorded, changed or voided.
 */
export async function refreshAutoDepositPayApplications(
  db: ReturnType<typeof getDb>,
  projectId: string,
  now: string
): Promise<void> {
  const drafts = await db
    .select({ id: projectBudgetApplications.id })
    .from(projectBudgetApplications)
    .where(
      and(
        eq(projectBudgetApplications.projectId, projectId),
        eq(projectBudgetApplications.status, "draft"),
        eq(projectBudgetApplications.depositAppliedMode, "auto")
      )
    )
    .orderBy(projectBudgetApplications.createdAt)
  // Oldest first, so the earliest draw takes the deposit.
  for (const draft of drafts) await refreshOwnerPayApplication(db, projectId, draft.id, now)
}
