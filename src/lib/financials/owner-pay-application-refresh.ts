import { and, eq, inArray, ne, notInArray, sql, type SQL } from "drizzle-orm"

import type { getDb } from "@/db"
import {
  projectBudgetApplications,
  projectBudgetLines,
  projectContractDeposits,
  projectOperations,
} from "@/db/schema"
import { projectContractBudgetRevisions } from "@/db/schema-estimates"
import { payApplicationShopTicketImports } from "@/db/schema-shop-tickets"
import { chunkD1InsertRows, chunkD1Values, isBatchGuardFailure } from "@/lib/d1-query"
import { canonicalFeeCostCode, mixesFeeCostCodes } from "@/lib/domain/financials/builder-fee-codes"
import { SAGE_SNAPSHOT_SOURCE } from "@/lib/domain/financials/rules"
import { updateOperations } from "@/lib/domain/operations/store"
import { respreadShopTicketContributions } from "@/lib/domain/budget/rules"
import {
  deleteBudgetLinesStatement,
  deleteShopTicketImportsStatement,
  draftPayApplicationGuardStatement,
  insertBudgetLinesStatement,
  insertShopTicketImportsStatements,
  updateBudgetApplications,
  updateBudgetApplicationsStatement,
  updateBudgetLinesStatement,
} from "@/lib/domain/budget/store"
import {
  currentPaymentDueAfterDeposit,
  depositAppliedToDraw,
  drawAmountBeforeDeposit,
  unappliedDeposit,
} from "@/lib/financials/contract-deposits"
import {
  distributeCents,
  loadPayApplicationShares,
  shareKey,
  splitNeedsSpreading,
  type PayApplicationShare,
} from "@/lib/financials/pay-application-shares"

/** Pay applications that can carry an applied deposit (not projections). */
const DEPOSIT_EXCLUDED_APPLICATION_STATUSES = ["budget_current", "budget_superseded", "void"] as const

/** Statuses never taken as the prior draw: budget views, unfinished, void or replaced draws. */
const PRIOR_DRAW_EXCLUDED_STATUSES = ["budget_current", "budget_superseded", "building", "void", "superseded"] as const

/**
 * Pay applications a new draft can carry forward from as the prior draw.
 * Sage job-cost snapshots share the table but are not draws.
 */
export function priorPayApplicationCondition(projectId: string): SQL | undefined {
  return and(
    eq(projectBudgetApplications.projectId, projectId),
    ne(projectBudgetApplications.sourceSystem, SAGE_SNAPSHOT_SOURCE),
    notInArray(projectBudgetApplications.status, [...PRIOR_DRAW_EXCLUDED_STATUSES])
  )
}

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

/**
 * Billed amounts on a pay application synced from Sage are read only in
 * Compass: they change in Sage and come back with the next sync.
 */
export async function assertBilledAmountsEditable(db: ReturnType<typeof getDb>, applicationId: string): Promise<void> {
  const application = await db
    .select({ billingSource: projectBudgetApplications.billingSource })
    .from(projectBudgetApplications)
    .where(eq(projectBudgetApplications.id, applicationId))
    .get()
  if (application?.billingSource === "sage") {
    throw new Error("This pay request's billed amounts are synced from Sage. Change them in Sage, then Sync with Sage.")
  }
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
  await updateBudgetApplications(db, eq(projectBudgetApplications.id, applicationId), {
    totalCompletedStoredToDate,
    retainageHeld,
    totalEarnedLessRetainage,
    depositApplied,
    currentPaymentDue,
    balanceToFinish,
    updatedAt: now,
  })
  await updateOperations(
    db,
    and(eq(projectOperations.projectId, projectId), eq(projectOperations.sourceRecordId, applicationId)),
    { amount: currentPaymentDue, updatedAt: now }
  )
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
 * A line billed to exactly its scheduled value stays fully billed when a change
 * order moves that value: this period's work takes the difference, so a credit
 * or an added charge reaches the draw without re-entering it. Null when the
 * line wasn't fully billed, its value didn't change, or the difference would
 * take this period's work below zero.
 */
export function fullyBilledWorkOnRevision(
  line: {
    readonly adjustedEstimate: number
    readonly previousWorkCompleted: number
    readonly storedMaterials: number
    readonly totalCosts: number
    readonly retainageHeld: number
  },
  adjustedBudgetCents: number
): {
  readonly currentWorkCompleted: number
  readonly currentCosts: number
  readonly totalCosts: number
  readonly percentComplete: number
  readonly balanceToFinish: number
  readonly retainageHeld: number
} | null {
  const scheduledCents = Math.round(line.adjustedEstimate * 100)
  if (scheduledCents <= 0 || Math.round(line.totalCosts * 100) !== scheduledCents) return null
  if (adjustedBudgetCents === scheduledCents) return null
  const currentCents = adjustedBudgetCents - Math.round(line.previousWorkCompleted * 100) - Math.round(line.storedMaterials * 100)
  if (currentCents < 0) return null
  const retainageRate = line.totalCosts > 0 ? line.retainageHeld / line.totalCosts : 0
  const total = adjustedBudgetCents / 100
  return {
    currentWorkCompleted: currentCents / 100,
    currentCosts: roundCents(currentCents / 100 + line.storedMaterials),
    totalCosts: total,
    percentComplete: 100,
    balanceToFinish: 0,
    retainageHeld: roundCents(total * retainageRate),
  }
}

type ShareLineAmounts = {
  readonly previousWorkCompletedCents: number
  readonly currentWorkCompletedCents: number
  readonly storedMaterialsCents: number
  readonly retainageHeldCents: number
  readonly priorChangesCents: number
}

/** A new pay application G703 row for one share of the contract budget. */
export function shareLineRow(
  share: PayApplicationShare,
  context: {
    readonly projectId: string
    readonly applicationId: string
    readonly revisionNumber: number
    readonly now: string
  },
  amounts: ShareLineAmounts
): typeof projectBudgetLines.$inferInsert {
  const previous = amounts.previousWorkCompletedCents / 100
  const current = amounts.currentWorkCompletedCents / 100
  const stored = amounts.storedMaterialsCents / 100
  const total = roundCents(previous + current + stored)
  const adjustedEstimate = share.adjustedBudgetCents / 100
  const totalChanges = share.approvedChangeCents / 100
  const priorChanges = amounts.priorChangesCents / 100
  return {
    id: crypto.randomUUID(),
    projectId: context.projectId,
    applicationId: context.applicationId,
    budgetRevisionLineId: share.budgetRevisionLineId,
    sourceSystem: "compass_contract_budget",
    sourceRecordId: share.budgetRevisionLineId,
    sourceRecordNumber: share.costCode,
    costCode: share.costCode,
    csiDivision: share.divisionCode,
    csiDivisionName: share.divisionName,
    description: share.description,
    notes: null,
    originalEstimate: share.originalEstimateCents / 100,
    priorChanges,
    currentChanges: roundCents(totalChanges - priorChanges),
    totalChanges,
    adjustedEstimate,
    previousWorkCompleted: previous,
    currentWorkCompleted: current,
    storedMaterials: stored,
    priorCosts: previous,
    currentCosts: roundCents(current + stored),
    totalCosts: total,
    percentComplete: adjustedEstimate > 0 ? Math.round((total / adjustedEstimate) * 1_000) / 10 : 0,
    balanceToFinish: roundCents(adjustedEstimate - total),
    retainageHeld: amounts.retainageHeldCents / 100,
    vendorName: null,
    ownerLabel: share.assemblyName ? `${share.description} · ${share.assemblyName}` : share.description,
    ownerVisible: share.ownerVisible,
    internalNotes: `Contract budget revision ${context.revisionNumber}.`,
    sortOrder: share.sortOrder,
    assemblyKey: share.assemblyKey,
    assemblyName: share.assemblyName,
    assemblySort: share.assemblySort,
    syncStatus: "compass_only",
    lastSyncedAt: null,
    createdAt: context.now,
    updatedAt: context.now,
  }
}

function cents(value: number): number {
  return Math.round(value * 100)
}

/**
 * Bring a draft pay application onto a contract budget revision and its
 * assembly split, keeping the work already entered. A cost code whose shares
 * are unchanged is updated in place (a fully billed row stays fully billed);
 * one whose split changed has its entered amounts spread across the new
 * shares by scheduled value. False when it was no longer a draft (sent to
 * review meanwhile); nothing changes then.
 */
export async function syncDraftPayApplication(
  db: ReturnType<typeof getDb>,
  projectId: string,
  applicationId: string,
  revisionId: string,
  now: string
): Promise<boolean> {
  const revision = await db
    .select()
    .from(projectContractBudgetRevisions)
    .where(eq(projectContractBudgetRevisions.id, revisionId))
    .get()
  if (!revision) throw new Error("Contract budget revision not found.")
  const [shares, existing, ticketImports] = await Promise.all([
    loadPayApplicationShares(db, revisionId),
    db.select().from(projectBudgetLines).where(eq(projectBudgetLines.applicationId, applicationId)),
    db
      .select()
      .from(payApplicationShopTicketImports)
      .where(
        and(
          eq(payApplicationShopTicketImports.applicationId, applicationId),
          eq(payApplicationShopTicketImports.mode, "imported")
        )
      ),
  ])
  // Grouped by canonical cost code, so a builder fee row coded "99 10 00"
  // moves onto the "Company Overhead" share instead of being left behind.
  const oldByCode = new Map<string, (typeof existing)[number][]>()
  for (const line of existing) {
    const key = canonicalFeeCostCode(line.costCode)
    oldByCode.set(key, [...(oldByCode.get(key) ?? []), line])
  }
  const sharesByCode = new Map<string, PayApplicationShare[]>()
  for (const share of shares) {
    const key = canonicalFeeCostCode(share.costCode)
    sharesByCode.set(key, [...(sharesByCode.get(key) ?? []), share])
  }

  const statements = []
  const inserts: (typeof projectBudgetLines.$inferInsert)[] = []
  // Shop ticket amounts on removed lines: dropped with the line, or spread
  // onto a replaced code's new lines (below) the same way as its amounts.
  const removedLineIds: string[] = []
  const replacedLineCodes = new Map<string, string>()
  const newLinesByCode = new Map<string, { readonly id: string; readonly weightCents: number }[]>()
  const context = { projectId, applicationId, revisionNumber: revision.revisionNumber, now }
  for (const [costCode, codeShares] of sharesByCode) {
    const olds = oldByCode.get(costCode) ?? []
    const oldByKey = new Map(olds.map((line) => [shareKey(line.costCode, line.assemblyKey), line]))
    const spreadAmounts =
      mixesFeeCostCodes([...codeShares, ...olds].map((item) => item.costCode)) ||
      splitNeedsSpreading(
        olds.map((line) => ({
          assemblyKey: line.assemblyKey,
          hasAmounts:
            line.previousWorkCompleted !== 0 || line.currentWorkCompleted !== 0 || line.storedMaterials !== 0 || line.retainageHeld !== 0,
        })),
        codeShares
      )
    if (!spreadAmounts) {
      // Row by row: matching shares update in place, new shares start empty,
      // and rows with no share (and no amounts) are removed.
      const matchedIds = new Set<string>()
      for (const share of codeShares) {
        const line = oldByKey.get(shareKey(share.costCode, share.assemblyKey))
        if (!line) {
          inserts.push(
            shareLineRow(share, context, {
              previousWorkCompletedCents: 0,
              currentWorkCompletedCents: 0,
              storedMaterialsCents: 0,
              retainageHeldCents: 0,
              priorChangesCents: 0,
            })
          )
          continue
        }
        matchedIds.add(line.id)
        statements.push(
          updateBudgetLinesStatement(db, eq(projectBudgetLines.id, line.id), {
            budgetRevisionLineId: share.budgetRevisionLineId,
            sourceRecordId: share.budgetRevisionLineId,
            ...lineAmountsOnRevision(line, share),
            ...(fullyBilledWorkOnRevision(line, share.adjustedBudgetCents) ?? {}),
            assemblyName: share.assemblyName,
            assemblySort: share.assemblySort,
            ownerLabel: share.assemblyName ? `${share.description} · ${share.assemblyName}` : share.description,
            internalNotes: `Contract budget revision ${revision.revisionNumber}.`,
            updatedAt: now,
          })
        )
      }
      for (const line of olds) {
        if (matchedIds.has(line.id)) continue
        removedLineIds.push(line.id)
        statements.push(deleteBudgetLinesStatement(db, eq(projectBudgetLines.id, line.id)))
      }
      continue
    }
    const weights = codeShares.map((share) => Math.max(0, share.adjustedBudgetCents))
    const spread = (total: number): readonly number[] => distributeCents(total, weights)
    const previous = spread(olds.reduce((sum, line) => sum + cents(line.previousWorkCompleted), 0))
    const current = spread(olds.reduce((sum, line) => sum + cents(line.currentWorkCompleted), 0))
    const stored = spread(olds.reduce((sum, line) => sum + cents(line.storedMaterials), 0))
    const retainage = spread(olds.reduce((sum, line) => sum + cents(line.retainageHeld), 0))
    const priorChanges = distributeCents(
      olds.reduce((sum, line) => sum + cents(line.priorChanges), 0),
      codeShares.map((share) => Math.max(0, share.approvedChangeCents))
    )
    codeShares.forEach((share, index) => {
      const row = shareLineRow(share, context, {
        previousWorkCompletedCents: previous[index] ?? 0,
        currentWorkCompletedCents: current[index] ?? 0,
        storedMaterialsCents: stored[index] ?? 0,
        retainageHeldCents: retainage[index] ?? 0,
        priorChangesCents: priorChanges[index] ?? 0,
      })
      inserts.push(row)
      if (row.id) newLinesByCode.set(costCode, [...(newLinesByCode.get(costCode) ?? []), { id: row.id, weightCents: weights[index] ?? 0 }])
    })
    for (const line of olds) {
      removedLineIds.push(line.id)
      replacedLineCodes.set(line.id, costCode)
      statements.push(deleteBudgetLinesStatement(db, eq(projectBudgetLines.id, line.id)))
    }
  }
  const movedImports = ticketImports.filter((row) => row.budgetLineId !== null && removedLineIds.includes(row.budgetLineId))
  // Removed first, so the lines can go; re-added once the new lines exist.
  const importDeletes = chunkD1Values(removedLineIds).map((ids) =>
    deleteShopTicketImportsStatement(db, inArray(payApplicationShopTicketImports.budgetLineId, ids))
  )
  statements.unshift(...(movedImports.length > 0 ? importDeletes : []))
  for (const rows of chunkD1InsertRows(projectBudgetLines, inserts)) statements.push(insertBudgetLinesStatement(db, rows))
  const firstImport = new Map(movedImports.map((row) => [row.ticketId, row]))
  const respread = respreadShopTicketContributions(
    movedImports.flatMap((row) => (row.budgetLineId ? [{ ticketId: row.ticketId, budgetLineId: row.budgetLineId, amountCents: row.amountCents }] : [])),
    replacedLineCodes,
    newLinesByCode
  )
  statements.push(
    ...insertShopTicketImportsStatements(
      db,
      respread.map((row) => ({
        id: crypto.randomUUID(),
        applicationId,
        ...row,
        mode: "imported" as const,
        createdBy: firstImport.get(row.ticketId)?.createdBy ?? null,
        createdAt: firstImport.get(row.ticketId)?.createdAt ?? now,
      }))
    )
  )
  statements.push(
    updateBudgetApplicationsStatement(db, eq(projectBudgetApplications.id, applicationId), {
      budgetRevisionId: revisionId,
      sourceRecordId: revisionId,
      originalContractSum: revision.originalContractSumCents / 100,
      netChanges: revision.approvedChangesCents / 100,
      contractSumToDate: revision.revisedContractSumCents / 100,
      updatedAt: now,
    })
  )
  try {
    // Only while it is still a draft: a draw sent to review keeps its lines.
    await db.batch([draftPayApplicationGuardStatement(db, projectId, applicationId), ...statements])
  } catch (error) {
    if (isBatchGuardFailure(error)) return false
    throw error
  }
  await refreshOwnerPayApplication(db, projectId, applicationId, now)
  return true
}

/** Whether a draft's rows no longer match the revision's cost code and assembly split. */
export function draftSplitIsStale(
  rows: readonly { readonly costCode: string; readonly assemblyKey: string | null; readonly adjustedEstimate: number }[],
  shares: readonly PayApplicationShare[]
): boolean {
  const rowsByKey = new Map(rows.map((row) => [shareKey(row.costCode, row.assemblyKey), row]))
  if (rowsByKey.size !== shares.length) return true
  return shares.some((share) => {
    const row = rowsByKey.get(shareKey(share.costCode, share.assemblyKey))
    return !row || cents(row.adjustedEstimate) !== share.adjustedBudgetCents
  })
}

/**
 * Move draft pay applications onto a newly current contract budget revision,
 * so an executed change order reaches the draw being prepared. Submitted pay
 * applications keep the revision they were prepared against.
 */
export async function moveDraftPayApplicationsToRevision(
  db: ReturnType<typeof getDb>,
  projectId: string,
  revisionId: string,
  now: string
): Promise<number> {
  const drafts = await db
    .select({ id: projectBudgetApplications.id })
    .from(projectBudgetApplications)
    .where(
      and(
        eq(projectBudgetApplications.projectId, projectId),
        eq(projectBudgetApplications.sourceSystem, "compass_contract_budget"),
        eq(projectBudgetApplications.status, "draft"),
        // A pay request synced from Sage keeps Sage's lines.
        eq(projectBudgetApplications.billingSource, "compass"),
        ne(projectBudgetApplications.budgetRevisionId, revisionId)
      )
    )
    .orderBy(projectBudgetApplications.createdAt)
  let moved = 0
  for (const draft of drafts) if (await syncDraftPayApplication(db, projectId, draft.id, revisionId, now)) moved += 1
  return moved
}
