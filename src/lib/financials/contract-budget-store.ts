import { and, desc, eq, inArray } from "drizzle-orm"

import { getDb } from "@/db"
import {
  projectBudgetApplications,
  projectBudgetLines,
  projectChangeOrderLines,
  projectChangeOrders,
} from "@/db/schema"
import {
  projectContractBudgetAdjustments,
  projectContractBudgetLines,
  projectContractBudgetRevisions,
  projectEstimateLines,
  projectEstimates,
} from "@/db/schema-estimates"
import {
  buildContractBudget,
  contractBudgetSourceHash,
  type ContractAdjustment,
  type EstimateLedgerLine,
} from "@/lib/financials/estimate-ledger"
import { CONTRACT_ADJUSTMENT_COST_CODES } from "@/lib/financials/project-totals-import"

export type ContractBudgetRebuildResult =
  | {
      readonly success: true
      readonly revisionId: string
      readonly revisionNumber: number
      readonly changed: boolean
    }
  | { readonly success: false; readonly error: string }

type CompassDb = ReturnType<typeof getDb>

const BUDGET_CHANGE_ORDER_STATUSES = [
  "executed",
  "sage_pending",
  "synced",
  "closed",
]

function estimateLedgerLine(
  row: typeof projectEstimateLines.$inferSelect
): EstimateLedgerLine {
  return {
    id: row.id,
    divisionCode: row.divisionCode,
    divisionName: row.divisionName,
    costCode: row.costCode,
    description: row.description,
    directCostCents: row.directCostCents,
    markupCents: row.markupCents,
    taxCents: row.taxCents,
    lineTotalCents: row.lineTotalCents,
    ownerVisible: row.ownerVisible,
    includeInBuilderFee: row.includeInBuilderFee,
    sortOrder: row.sortOrder,
  }
}

function builderFeeLedgerLines(
  estimate: typeof projectEstimates.$inferSelect
): readonly EstimateLedgerLine[] {
  const amounts = [
    estimate.overheadCents,
    estimate.marginCents,
    estimate.contingencyCents,
  ]
  return CONTRACT_ADJUSTMENT_COST_CODES.flatMap((item, index) => {
    const amount = amounts[index] ?? 0
    if (amount === 0) return []
    return [{
      id: null,
      divisionCode: "99",
      divisionName: "Builder Fee",
      costCode: item.value,
      description: item.description,
      directCostCents: amount,
      markupCents: 0,
      taxCents: 0,
      lineTotalCents: amount,
      ownerVisible: true,
      includeInBuilderFee: false,
      sortOrder: 100_000 + index,
    }]
  })
}

export async function rebuildProjectContractBudget(input: {
  readonly db: CompassDb
  readonly projectId: string
  readonly actorUserId: string | null
}): Promise<ContractBudgetRebuildResult> {
  const acceptedRows = await input.db
    .select()
    .from(projectEstimates)
    .where(
      and(
        eq(projectEstimates.projectId, input.projectId),
        eq(projectEstimates.status, "accepted")
      )
    )
    .orderBy(desc(projectEstimates.versionNumber))
    .limit(1)
  const accepted = acceptedRows[0]
  if (!accepted) {
    return {
      success: false,
      error: "Accept a signed estimate before building the contract budget.",
    }
  }

  const estimateRows = await input.db
    .select()
    .from(projectEstimateLines)
    .where(eq(projectEstimateLines.estimateId, accepted.id))
    .orderBy(
      projectEstimateLines.divisionCode,
      projectEstimateLines.sortOrder
    )
  if (estimateRows.length === 0) {
    return { success: false, error: "The accepted estimate has no lines." }
  }

  const changeRows = await input.db
    .select({
      id: projectChangeOrderLines.id,
      changeOrderId: projectChangeOrderLines.changeOrderId,
      costCode: projectChangeOrderLines.costCode,
      description: projectChangeOrderLines.description,
      amountCents: projectChangeOrderLines.amountCents,
      executedAt: projectChangeOrders.executedAt,
    })
    .from(projectChangeOrderLines)
    .innerJoin(
      projectChangeOrders,
      eq(projectChangeOrders.id, projectChangeOrderLines.changeOrderId)
    )
    .where(
      and(
        eq(projectChangeOrderLines.projectId, input.projectId),
        inArray(projectChangeOrders.status, BUDGET_CHANGE_ORDER_STATUSES)
      )
    )

  const incompleteChange = changeRows.find(
    (row) => !row.costCode || row.amountCents === null || !row.executedAt
  )
  if (incompleteChange) {
    return {
      success: false,
      error:
        "Every executed change-order line needs a cost code, amount, and execution date before the budget can be revised.",
    }
  }

  const adjustments: ContractAdjustment[] = []
  for (const row of changeRows) {
    if (!row.costCode || row.amountCents === null || !row.executedAt) continue
    adjustments.push({
      id: row.id,
      changeOrderId: row.changeOrderId,
      costCode: row.costCode,
      description: row.description,
      amountCents: row.amountCents,
      executedAt: row.executedAt,
    })
  }

  const sourceHash = await contractBudgetSourceHash({
    estimateId: accepted.id,
    estimateSourceHash: accepted.sourceHash,
    adjustments,
  })
  const matchingRows = await input.db
    .select({
      id: projectContractBudgetRevisions.id,
      revisionNumber: projectContractBudgetRevisions.revisionNumber,
      status: projectContractBudgetRevisions.status,
    })
    .from(projectContractBudgetRevisions)
    .where(
      and(
        eq(projectContractBudgetRevisions.projectId, input.projectId),
        eq(projectContractBudgetRevisions.sourceHash, sourceHash)
      )
    )
    .limit(1)
  const matching = matchingRows[0]
  if (matching?.status === "current") {
    return {
      success: true,
      revisionId: matching.id,
      revisionNumber: matching.revisionNumber,
      changed: false,
    }
  }

  const priorRows = await input.db
    .select({ revisionNumber: projectContractBudgetRevisions.revisionNumber })
    .from(projectContractBudgetRevisions)
    .where(eq(projectContractBudgetRevisions.projectId, input.projectId))
    .orderBy(desc(projectContractBudgetRevisions.revisionNumber))
    .limit(1)
  const revisionNumber = (priorRows[0]?.revisionNumber ?? 0) + 1
  const revisionId = crypto.randomUUID()
  const now = new Date().toISOString()
  const budget = buildContractBudget({
    estimateLines: [
      ...estimateRows.map(estimateLedgerLine),
      ...builderFeeLedgerLines(accepted),
    ],
    adjustments,
  })

  await input.db.insert(projectContractBudgetRevisions).values({
    id: revisionId,
    projectId: input.projectId,
    acceptedEstimateId: accepted.id,
    revisionNumber,
    status: "building",
    originalContractSumCents: budget.originalContractSumCents,
    approvedChangesCents: budget.approvedChangesCents,
    revisedContractSumCents: budget.revisedContractSumCents,
    effectiveAt: now,
    sourceHash,
    createdBy: input.actorUserId,
    createdAt: now,
  })

  for (const line of budget.lines) {
    await input.db.insert(projectContractBudgetLines).values({
      id: crypto.randomUUID(),
      projectId: input.projectId,
      revisionId,
      sourceEstimateLineId: line.sourceEstimateLineId,
      divisionCode: line.divisionCode,
      divisionName: line.divisionName,
      costCode: line.costCode,
      description: line.description,
      originalEstimateCents: line.originalEstimateCents,
      approvedChangeCents: line.approvedChangeCents,
      adjustedBudgetCents: line.adjustedBudgetCents,
      ownerVisible: line.ownerVisible,
      sortOrder: line.sortOrder,
      createdAt: now,
    })
  }

  for (const adjustment of adjustments) {
    await input.db.insert(projectContractBudgetAdjustments).values({
      id: crypto.randomUUID(),
      projectId: input.projectId,
      revisionId,
      changeOrderId: adjustment.changeOrderId,
      changeOrderLineId: adjustment.id,
      costCode: adjustment.costCode,
      description: adjustment.description,
      amountCents: adjustment.amountCents,
      executedAt: adjustment.executedAt,
      createdAt: now,
    })
  }

  const projectionId = `contract-budget-view:${revisionId}`
  await input.db.insert(projectBudgetApplications).values({
    id: projectionId,
    projectId: input.projectId,
    sourceSystem: "compass_contract_budget_projection",
    sourceRecordId: revisionId,
    applicationNumber: `Contract Budget R${revisionNumber}`,
    periodTo: now.slice(0, 10),
    status: "budget_current",
    originalContractSum: budget.originalContractSumCents / 100,
    netChanges: budget.approvedChangesCents / 100,
    contractSumToDate: budget.revisedContractSumCents / 100,
    totalCompletedStoredToDate: 0,
    retainageHeld: 0,
    totalEarnedLessRetainage: 0,
    previousCertificates: 0,
    currentPaymentDue: 0,
    balanceToFinish: budget.revisedContractSumCents / 100,
    ownerVisible: true,
    sourceUrl: null,
    budgetRevisionId: revisionId,
    syncStatus: "compass_only",
    lastSyncedAt: null,
    createdAt: now,
    updatedAt: now,
  })
  if (budget.lines.length > 0) {
    const revisionLines = await input.db
      .select()
      .from(projectContractBudgetLines)
      .where(eq(projectContractBudgetLines.revisionId, revisionId))
    await input.db.insert(projectBudgetLines).values(
      revisionLines.map((line) => ({
        id: crypto.randomUUID(),
        projectId: input.projectId,
        applicationId: projectionId,
        budgetRevisionLineId: line.id,
        sourceSystem: "compass_contract_budget_projection",
        sourceRecordId: line.id,
        sourceRecordNumber: line.costCode,
        costCode: line.costCode,
        csiDivision: line.divisionCode,
        csiDivisionName: line.divisionName,
        description: line.description,
        notes: null,
        originalEstimate: line.originalEstimateCents / 100,
        priorChanges: line.approvedChangeCents / 100,
        currentChanges: 0,
        totalChanges: line.approvedChangeCents / 100,
        adjustedEstimate: line.adjustedBudgetCents / 100,
        previousWorkCompleted: 0,
        currentWorkCompleted: 0,
        storedMaterials: 0,
        priorCosts: 0,
        currentCosts: 0,
        totalCosts: 0,
        percentComplete: 0,
        balanceToFinish: line.adjustedBudgetCents / 100,
        retainageHeld: 0,
        vendorName: null,
        ownerLabel: line.description,
        ownerVisible: line.ownerVisible,
        internalNotes: `Derived from accepted estimate and executed change orders, revision ${revisionNumber}.`,
        sortOrder: line.sortOrder,
        syncStatus: "compass_only",
        lastSyncedAt: null,
        createdAt: now,
        updatedAt: now,
      }))
    )
  }

  await input.db
    .update(projectContractBudgetRevisions)
    .set({ status: "superseded" })
    .where(
      and(
        eq(projectContractBudgetRevisions.projectId, input.projectId),
        eq(projectContractBudgetRevisions.status, "current")
      )
    )
    .run()
  await input.db
    .update(projectBudgetApplications)
    .set({ status: "budget_superseded", updatedAt: now })
    .where(
      and(
        eq(projectBudgetApplications.projectId, input.projectId),
        eq(projectBudgetApplications.status, "budget_current"),
        eq(
          projectBudgetApplications.sourceSystem,
          "compass_contract_budget_projection"
        )
      )
    )
    .run()
  await input.db
    .update(projectContractBudgetRevisions)
    .set({ status: "current" })
    .where(eq(projectContractBudgetRevisions.id, revisionId))
    .run()
  await input.db
    .update(projectBudgetApplications)
    .set({ status: "budget_current", updatedAt: now })
    .where(eq(projectBudgetApplications.id, projectionId))
    .run()

  return {
    success: true,
    revisionId,
    revisionNumber,
    changed: true,
  }
}
