import { and, eq, ne, notInArray, sql } from "drizzle-orm"

import type { getDb } from "@/db"
import {
  projectBudgetApplications,
  projectBudgetLines,
  projectContractDeposits,
  projectOperations,
} from "@/db/schema"
import {
  projectContractBudgetLines,
  projectContractBudgetRevisions,
} from "@/db/schema-estimates"
import { chunkD1Rows } from "@/lib/d1-query"
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

function roundCents(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * A draft G703 line's budget amounts on a new contract budget revision. Work
 * already entered is kept; the change since the old revision is a current
 * change, and retainage keeps the line's rate.
 */
export function lineAmountsOnRevision(
  line: {
    readonly totalChanges: number
    readonly currentChanges: number
    readonly totalCosts: number
    readonly retainageHeld: number
  },
  revisionLine: {
    readonly originalEstimateCents: number
    readonly approvedChangeCents: number
    readonly adjustedBudgetCents: number
  }
): {
  readonly originalEstimate: number
  readonly priorChanges: number
  readonly currentChanges: number
  readonly totalChanges: number
  readonly adjustedEstimate: number
  readonly percentComplete: number
  readonly balanceToFinish: number
  readonly retainageHeld: number
} {
  const totalChanges = revisionLine.approvedChangeCents / 100
  const adjustedEstimate = revisionLine.adjustedBudgetCents / 100
  const currentChanges = roundCents(line.currentChanges + totalChanges - line.totalChanges)
  const retainageRate = line.totalCosts > 0 ? line.retainageHeld / line.totalCosts : 0
  return {
    originalEstimate: revisionLine.originalEstimateCents / 100,
    priorChanges: roundCents(totalChanges - currentChanges),
    currentChanges,
    totalChanges,
    adjustedEstimate,
    percentComplete: adjustedEstimate > 0 ? Math.round((line.totalCosts / adjustedEstimate) * 1_000) / 10 : 0,
    balanceToFinish: roundCents(adjustedEstimate - line.totalCosts),
    retainageHeld: roundCents(line.totalCosts * retainageRate),
  }
}

/**
 * Move draft pay applications onto a newly current contract budget revision,
 * so an executed change order reaches the draw being prepared. Work, stored
 * materials, retainage rate and visibility already entered on each cost code
 * are kept; the change since the draft's revision counts as a current change.
 * Submitted pay applications keep the revision they were prepared against.
 */
export async function moveDraftPayApplicationsToRevision(
  db: ReturnType<typeof getDb>,
  projectId: string,
  revisionId: string,
  now: string
): Promise<number> {
  const revision = await db
    .select()
    .from(projectContractBudgetRevisions)
    .where(eq(projectContractBudgetRevisions.id, revisionId))
    .get()
  if (!revision) return 0
  const drafts = await db
    .select()
    .from(projectBudgetApplications)
    .where(
      and(
        eq(projectBudgetApplications.projectId, projectId),
        eq(projectBudgetApplications.sourceSystem, "compass_contract_budget"),
        eq(projectBudgetApplications.status, "draft"),
        ne(projectBudgetApplications.budgetRevisionId, revisionId)
      )
    )
    .orderBy(projectBudgetApplications.createdAt)
  if (drafts.length === 0) return 0
  const revisionLines = await db
    .select()
    .from(projectContractBudgetLines)
    .where(eq(projectContractBudgetLines.revisionId, revisionId))
    .orderBy(projectContractBudgetLines.divisionCode, projectContractBudgetLines.sortOrder)

  for (const draft of drafts) {
    const existing = await db
      .select()
      .from(projectBudgetLines)
      .where(eq(projectBudgetLines.applicationId, draft.id))
    const byCostCode = new Map(existing.map((line) => [line.costCode, line]))
    const inserts: (typeof projectBudgetLines.$inferInsert)[] = []
    const statements = []
    for (const revisionLine of revisionLines) {
      const originalEstimate = revisionLine.originalEstimateCents / 100
      const totalChanges = revisionLine.approvedChangeCents / 100
      const adjustedEstimate = revisionLine.adjustedBudgetCents / 100
      const line = byCostCode.get(revisionLine.costCode)
      if (line) {
        statements.push(
          db
            .update(projectBudgetLines)
            .set({
              budgetRevisionLineId: revisionLine.id,
              sourceRecordId: revisionLine.id,
              ...lineAmountsOnRevision(line, revisionLine),
              internalNotes: `Contract budget revision ${revision.revisionNumber}.`,
              updatedAt: now,
            })
            .where(eq(projectBudgetLines.id, line.id))
        )
        continue
      }
      inserts.push({
        id: crypto.randomUUID(),
        projectId,
        applicationId: draft.id,
        budgetRevisionLineId: revisionLine.id,
        sourceSystem: "compass_contract_budget",
        sourceRecordId: revisionLine.id,
        sourceRecordNumber: revisionLine.costCode,
        costCode: revisionLine.costCode,
        csiDivision: revisionLine.divisionCode,
        csiDivisionName: revisionLine.divisionName,
        description: revisionLine.description,
        notes: null,
        originalEstimate,
        priorChanges: 0,
        currentChanges: totalChanges,
        totalChanges,
        adjustedEstimate,
        previousWorkCompleted: 0,
        currentWorkCompleted: 0,
        storedMaterials: 0,
        priorCosts: 0,
        currentCosts: 0,
        totalCosts: 0,
        percentComplete: 0,
        balanceToFinish: adjustedEstimate,
        retainageHeld: 0,
        vendorName: null,
        ownerLabel: revisionLine.description,
        ownerVisible: revisionLine.ownerVisible,
        internalNotes: `Contract budget revision ${revision.revisionNumber}.`,
        sortOrder: revisionLine.sortOrder,
        syncStatus: "compass_only",
        lastSyncedAt: null,
        createdAt: now,
        updatedAt: now,
      })
    }
    for (const rows of chunkD1Rows(inserts)) {
      statements.push(db.insert(projectBudgetLines).values(rows))
    }
    statements.push(
      db
        .update(projectBudgetApplications)
        .set({
          budgetRevisionId: revisionId,
          sourceRecordId: revisionId,
          originalContractSum: revision.originalContractSumCents / 100,
          netChanges: revision.approvedChangesCents / 100,
          contractSumToDate: revision.revisedContractSumCents / 100,
          updatedAt: now,
        })
        .where(eq(projectBudgetApplications.id, draft.id))
    )
    const [first, ...rest] = statements
    if (first) await db.batch([first, ...rest])
    await refreshOwnerPayApplication(db, projectId, draft.id, now)
  }
  return drafts.length
}
