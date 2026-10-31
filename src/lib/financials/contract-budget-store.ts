import { and, desc, eq, inArray } from "drizzle-orm"

import { getDb } from "@/db"
import {
  projectChangeOrderLines,
  projectChangeOrders,
  sageCostCodes,
} from "@/db/schema"
import {
  projectContractBudgetRevisions,
  projectEstimateLines,
  projectEstimates,
} from "@/db/schema-estimates"
import {
  activateBudgetProjectionStatement,
  insertBudgetApplicationStatement,
  insertBudgetLinesStatement,
  supersedeCurrentBudgetProjectionStatement,
} from "@/lib/domain/budget/store"
import {
  contractBudgetApplicationNumber,
  contractBudgetProjectionId,
  contractBudgetRevisionPlan,
  nextContractBudgetRevisionNumber,
} from "@/lib/domain/financials/rules"
import {
  insertContractBudgetAdjustmentStatement,
  insertContractBudgetLineStatement,
  insertContractBudgetRevisionStatement,
  makeContractBudgetRevisionCurrentStatement,
  supersedeCurrentContractBudgetRevisionStatement,
} from "@/lib/domain/financials/store"
import { calculateEstimateTotals, type EstimateLedgerLine } from "@/lib/domain/estimates/rules"
import {
  buildContractBudget,
  contractBudgetSourceHash,
  type ContractAdjustment,
} from "@/lib/financials/estimate-ledger"
import { moveDraftPayApplicationsToRevision } from "@/lib/financials/owner-pay-application-refresh"
import { CONTRACT_ADJUSTMENT_COST_CODES } from "@/lib/financials/project-totals-import"
import { contractEstimateConditions } from "@/lib/estimates/estimate-family"

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
  estimate: Pick<typeof projectEstimates.$inferSelect, "overheadCents" | "marginCents" | "contingencyCents">,
  sageRows: readonly {
    readonly code: string
    readonly description: string
    readonly divisionCode: string
    readonly divisionDescription: string
  }[]
): readonly EstimateLedgerLine[] {
  const amounts = [
    estimate.overheadCents,
    estimate.marginCents,
    estimate.contingencyCents,
  ]
  return CONTRACT_ADJUSTMENT_COST_CODES.flatMap((item, index) => {
    const amount = amounts[index] ?? 0
    if (amount === 0) return []
    const sageRow = sageRows.find(
      (row) => row.description.trim().toLowerCase() === item.description.toLowerCase()
    )
    return [{
      id: null,
      divisionCode: sageRow?.divisionCode ?? "00",
      divisionName: sageRow?.divisionDescription ?? "Procurement Requirements",
      costCode: sageRow?.code ?? item.description,
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

/** Sage cost codes for the builder-fee lines. */
function builderFeeSageRows(db: CompassDb) {
  return db
    .select({
      code: sageCostCodes.code,
      description: sageCostCodes.description,
      divisionCode: sageCostCodes.divisionCode,
      divisionDescription: sageCostCodes.divisionDescription,
    })
    .from(sageCostCodes)
    .where(
      and(
        eq(sageCostCodes.active, true),
        inArray(
          sageCostCodes.description,
          CONTRACT_ADJUSTMENT_COST_CODES.map((item) => item.description)
        )
      )
    )
}

/**
 * An estimate's lines as budget ledger lines, plus its builder-fee lines
 * (overhead, margin, contingency) mapped to their Sage cost codes. Used for
 * the contract budget and for change orders executed from an estimate.
 */
export async function estimateBudgetLedgerLines(
  db: CompassDb,
  estimate: typeof projectEstimates.$inferSelect
): Promise<{ readonly lines: readonly EstimateLedgerLine[]; readonly estimateLineCount: number }> {
  const [feeSageRows, estimateRows] = await Promise.all([
    builderFeeSageRows(db),
    db
      .select()
      .from(projectEstimateLines)
      .where(eq(projectEstimateLines.estimateId, estimate.id))
      .orderBy(projectEstimateLines.divisionCode, projectEstimateLines.sortOrder),
  ])
  return {
    lines: [...estimateRows.map(estimateLedgerLine), ...builderFeeLedgerLines(estimate, feeSageRows)],
    estimateLineCount: estimateRows.length,
  }
}

/**
 * Some of an estimate's lines as budget ledger lines, plus the builder fee
 * those lines carry at the estimate's rates. Used to price a deduct change
 * order for scope leaving a signed estimate.
 */
export async function estimateLinesBudgetLedgerLines(
  db: CompassDb,
  estimate: typeof projectEstimates.$inferSelect,
  rows: readonly (typeof projectEstimateLines.$inferSelect)[]
): Promise<readonly EstimateLedgerLine[]> {
  const lines = rows.map(estimateLedgerLine)
  const totals = calculateEstimateTotals(lines, estimate)
  return [...lines, ...builderFeeLedgerLines(totals, await builderFeeSageRows(db))]
}

/**
 * The estimate the original contract sum comes from. A version accepted
 * through a difference change order keeps the earlier contract as the base;
 * its changes reach the budget through that executed change order.
 */
async function originalContractEstimate(
  db: CompassDb,
  projectId: string,
  accepted: typeof projectEstimates.$inferSelect
): Promise<typeof projectEstimates.$inferSelect> {
  let current = accepted
  const seen = new Set<string>([accepted.id])
  for (;;) {
    const link = await db
      .select({ baselineEstimateId: projectChangeOrders.baselineEstimateId })
      .from(projectChangeOrders)
      .where(
        and(
          eq(projectChangeOrders.projectId, projectId),
          eq(projectChangeOrders.replacementEstimateId, current.id),
          eq(projectChangeOrders.budgetTreatment, "additive"),
          inArray(projectChangeOrders.status, BUDGET_CHANGE_ORDER_STATUSES)
        )
      )
      .get()
    if (!link?.baselineEstimateId || seen.has(link.baselineEstimateId)) return current
    const previous = await db
      .select()
      .from(projectEstimates)
      .where(and(eq(projectEstimates.projectId, projectId), eq(projectEstimates.id, link.baselineEstimateId)))
      .get()
    if (!previous) return current
    seen.add(previous.id)
    current = previous
  }
}

export async function rebuildProjectContractBudget(input: {
  readonly db: CompassDb
  readonly projectId: string
  readonly actorUserId: string | null
  readonly acceptedEstimateId?: string
  readonly publish?: boolean
}): Promise<ContractBudgetRebuildResult> {
  const estimateWhere = input.acceptedEstimateId
    ? and(
        eq(projectEstimates.projectId, input.projectId),
        eq(projectEstimates.id, input.acceptedEstimateId)
      )
    : and(
        eq(projectEstimates.projectId, input.projectId),
        eq(projectEstimates.status, "accepted"),
        // Change-order estimates feed the budget through their change order.
        ...contractEstimateConditions()
      )
  const acceptedRows = await input.db
    .select()
    .from(projectEstimates)
    .where(estimateWhere)
    .orderBy(desc(projectEstimates.versionNumber))
    .limit(1)
  const accepted = acceptedRows[0]
  if (!accepted) {
    return {
      success: false,
      error: "Choose a signed estimate before building the contract budget.",
    }
  }

  const original = input.acceptedEstimateId
    ? accepted
    : await originalContractEstimate(input.db, input.projectId, accepted)
  const ledgerLines = await estimateBudgetLedgerLines(input.db, original)
  if (ledgerLines.estimateLineCount === 0) {
    return { success: false, error: "The accepted estimate has no lines." }
  }

  const changeRows = await input.db
    .select({
      id: projectChangeOrderLines.id,
      changeOrderId: projectChangeOrderLines.changeOrderId,
      costCode: projectChangeOrderLines.costCode,
      description: projectChangeOrderLines.description,
      amountCents: projectChangeOrderLines.amountCents,
      contractAssemblyId: projectChangeOrderLines.contractAssemblyId,
      assemblyName: projectChangeOrderLines.assemblyName,
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
        eq(projectChangeOrders.budgetTreatment, "additive"),
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
  const plan = contractBudgetRevisionPlan(matching?.status)
  if (matching && plan === "unchanged") {
    return {
      success: true,
      revisionId: matching.id,
      revisionNumber: matching.revisionNumber,
      changed: false,
    }
  }
  if (matching && plan === "reuse") {
    if (input.publish === false) {
      return {
        success: true,
        revisionId: matching.id,
        revisionNumber: matching.revisionNumber,
        changed: true,
      }
    }
    const now = new Date().toISOString()
    await activateContractBudgetRevision({
      db: input.db,
      projectId: input.projectId,
      revisionId: matching.id,
      now,
    })
    return {
      success: true,
      revisionId: matching.id,
      revisionNumber: matching.revisionNumber,
      changed: true,
    }
  }

  const priorRows = await input.db
    .select({ revisionNumber: projectContractBudgetRevisions.revisionNumber })
    .from(projectContractBudgetRevisions)
    .where(eq(projectContractBudgetRevisions.projectId, input.projectId))
    .orderBy(desc(projectContractBudgetRevisions.revisionNumber))
    .limit(1)
  const revisionNumber = nextContractBudgetRevisionNumber(priorRows[0]?.revisionNumber)
  const revisionId = crypto.randomUUID()
  const now = new Date().toISOString()
  const budget = buildContractBudget({
    estimateLines: [
      ...ledgerLines.lines,
    ],
    adjustments,
  })

  const revisionRow = {
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
  }
  const revisionLineRows = budget.lines.map((line) => ({
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
  }))
  // Lines tied to a contract assembly keep it, so pay applications show the
  // change inside that assembly.
  const assemblyByChangeLine = new Map(changeRows.map((row) => [row.id, row]))
  const adjustmentRows = adjustments.map((adjustment) => ({
    id: crypto.randomUUID(),
    projectId: input.projectId,
    revisionId,
    changeOrderId: adjustment.changeOrderId,
    changeOrderLineId: adjustment.id,
    costCode: adjustment.costCode,
    description: adjustment.description,
    amountCents: adjustment.amountCents,
    contractAssemblyId: assemblyByChangeLine.get(adjustment.id)?.contractAssemblyId ?? null,
    assemblyName: assemblyByChangeLine.get(adjustment.id)?.assemblyName ?? null,
    executedAt: adjustment.executedAt,
    createdAt: now,
  }))

  const projectionId = contractBudgetProjectionId(revisionId)
  const projectionRow = {
    id: projectionId,
    projectId: input.projectId,
    sourceSystem: "compass_contract_budget_projection",
    sourceRecordId: revisionId,
    applicationNumber: contractBudgetApplicationNumber(revisionNumber),
    periodTo: now.slice(0, 10),
    status: "building",
    originalContractSum: budget.originalContractSumCents / 100,
    netChanges: budget.approvedChangesCents / 100,
    contractSumToDate: budget.revisedContractSumCents / 100,
    totalCompletedStoredToDate: 0,
    retainageHeld: 0,
    totalEarnedLessRetainage: 0,
    previousCertificates: 0,
    currentPaymentDue: 0,
    balanceToFinish: budget.revisedContractSumCents / 100,
    ownerVisible: false,
    sourceUrl: null,
    budgetRevisionId: revisionId,
    syncStatus: "compass_only",
    lastSyncedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  const projectionLineRows = revisionLineRows.map((line) => ({
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
  const preparationStatements = [
    insertContractBudgetRevisionStatement(input.db, revisionRow),
    ...revisionLineRows.map((line) => insertContractBudgetLineStatement(input.db, line)),
    ...adjustmentRows.map((adjustment) => insertContractBudgetAdjustmentStatement(input.db, adjustment)),
    insertBudgetApplicationStatement(input.db, projectionRow),
    ...projectionLineRows.map((line) => insertBudgetLinesStatement(input.db, line)),
  ]
  const firstStatement = preparationStatements[0]
  if (!firstStatement) {
    return { success: false, error: "The budget revision could not be prepared." }
  }
  await input.db.batch([firstStatement, ...preparationStatements.slice(1)])

  if (input.publish !== false) {
    await activateContractBudgetRevision({
      db: input.db,
      projectId: input.projectId,
      revisionId,
      now,
    })
  }

  return {
    success: true,
    revisionId,
    revisionNumber,
    changed: true,
  }
}

async function activateContractBudgetRevision(input: {
  readonly db: CompassDb
  readonly projectId: string
  readonly revisionId: string
  readonly now: string
}): Promise<void> {
  const projectionId = contractBudgetProjectionId(input.revisionId)
  await input.db.batch([
    supersedeCurrentContractBudgetRevisionStatement(input.db, input.projectId),
    supersedeCurrentBudgetProjectionStatement(input.db, input.projectId, input.now),
    makeContractBudgetRevisionCurrentStatement(input.db, input.revisionId),
    activateBudgetProjectionStatement(input.db, projectionId, input.now),
  ])
  // Draft draws follow the new revision so an executed change order reaches them.
  await moveDraftPayApplicationsToRevision(input.db, input.projectId, input.revisionId, input.now)
}
