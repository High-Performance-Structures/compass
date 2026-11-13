// Estimates domain: variances (owner-requested changes billed with a fee by
// contract type, plus liability insurance), recorded as change orders.
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm"

import { projectChangeOrderHistory, projectChangeOrderLines, projectChangeOrders, projects } from "@/db/schema"
import { projectContractBudgetLines, projectContractBudgetRevisions, projectEstimates } from "@/db/schema-estimates"
import { activityActorName, recordActivityEvent } from "@/lib/activity-log"
import type { AuthUser } from "@/lib/auth"
import { loadProjectCostCodeChoices } from "@/lib/cost-codes/catalog-server"
import type { EstimateBuilderFeeRates } from "@/lib/domain/estimates/rules"
import type { ChangeOrderRecordType } from "@/lib/domain/estimates/statuses"
import {
  deleteChangeOrderLinesStatement,
  insertChangeOrderHistoryStatement,
  insertChangeOrderLineStatement,
  insertChangeOrderStatement,
  updateChangeOrdersStatement,
  type Statement,
} from "@/lib/domain/estimates/store"
import { changeOrderMoveStatements, changeOrderStatusGuardStatement, runGuardedChangeOrderBatch } from "@/lib/domain/estimates/change-order-status-store"
import {
  contractAllowsVariances,
  contractInsuranceRate,
  contractTypeLabel,
  derivedChangeLines,
  effectiveContractType,
  isInsuranceLine,
  nextChangeOrderNumber,
  nextVarianceNumbers,
  SELECTION_ROUND_VARIANCE_SOURCE,
  planVarianceLines,
  projectIsClosed,
  reclassificationError,
  varianceNumbersInDateOrder,
  type DerivedChangeLine,
  type InsuranceRule,
  type ProjectContractType,
  type VarianceLineInput,
} from "@/lib/domain/estimates/variance-rules"
import { DEFAULT_VARIANCE_SETTINGS, type VarianceSettings } from "@/lib/feature-settings/contract-settings"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { contractEstimateConditions } from "@/lib/estimates/estimate-family"
import { rebuildProjectContractBudget } from "@/lib/financials/contract-budget-store"
import type { Db } from "@/lib/server/action-context"
import { cleanText } from "@/lib/shared/guards"

/*
 * Variances on the change-order table (rules in ./variance-rules.ts). Staff
 * create a variance, enter its cost lines, and approve it; approval adds the
 * builder fee (straight cost plus only) and liability insurance lines,
 * executes it without an owner signature, and rebuilds the contract budget.
 * Staff can reclassify change orders as variances and back. Callers check
 * that the user is staff who may approve change orders.
 */

type ChangeOrderRow = typeof projectChangeOrders.$inferSelect

export type VarianceActor = Pick<AuthUser, "id" | "role" | "displayName" | "email" | "firstName" | "lastName">

export type VarianceResult =
  | { readonly success: true; readonly id: string; readonly budgetNote: string | null }
  | { readonly success: false; readonly error: string }

type VarianceProject = {
  readonly projectNumber: string | null
  readonly organizationId: string | null
  readonly closed: boolean
  readonly contractType: ProjectContractType
  readonly settings: VarianceSettings
}

async function varianceProject(db: Db, projectId: string): Promise<VarianceProject | null> {
  const project = await db
    .select({
      projectNumber: projects.projectNumber,
      organizationId: projects.organizationId,
      status: projects.status,
      jobStatusId: projects.jobStatusId,
      contractType: projects.contractType,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get()
  if (!project) return null
  const settings = project.organizationId
    ? await readFeatureSettings(db, project.organizationId, "variances")
    : DEFAULT_VARIANCE_SETTINGS
  return {
    projectNumber: project.projectNumber,
    organizationId: project.organizationId,
    closed: projectIsClosed(project),
    contractType: effectiveContractType(project.contractType, settings.defaultContractType),
    settings,
  }
}

/** The project's contract type and whether it takes variances, for the change-order pages. */
export async function projectVarianceSettings(
  db: Db,
  projectId: string
): Promise<{ readonly contractType: ProjectContractType; readonly allowsVariances: boolean; readonly closed: boolean } | null> {
  const project = await varianceProject(db, projectId)
  if (!project) return null
  return { contractType: project.contractType, allowsVariances: contractAllowsVariances(project.contractType), closed: project.closed }
}

/**
 * The insurance rule for a project: the contract's own insurance line (its
 * cost code and its share of the rest of the contract) or the company's
 * fixed percent, per Settings › Workflows › Variances.
 */
async function projectInsuranceRule(db: Db, projectId: string, settings: VarianceSettings): Promise<InsuranceRule> {
  const named = { costCode: settings.insuranceCostCode, description: settings.insuranceDescription }
  if (settings.insuranceRateSource === "off") return { ...named, rate: 0 }
  const revision = await db
    .select({ id: projectContractBudgetRevisions.id })
    .from(projectContractBudgetRevisions)
    .where(and(eq(projectContractBudgetRevisions.projectId, projectId), eq(projectContractBudgetRevisions.status, "current")))
    .orderBy(desc(projectContractBudgetRevisions.revisionNumber))
    .get()
  const lines = revision
    ? await db
        .select({
          costCode: projectContractBudgetLines.costCode,
          description: projectContractBudgetLines.description,
          originalEstimateCents: projectContractBudgetLines.originalEstimateCents,
        })
        .from(projectContractBudgetLines)
        .where(eq(projectContractBudgetLines.revisionId, revision.id))
    : []
  // The contract's insurance line keeps its own code, so changes merge into that G703 line.
  const contractLine = lines.find((line) => isInsuranceLine(line, named))
  const costCode = contractLine?.costCode ?? named.costCode
  const rate =
    settings.insuranceRateSource === "fixed" ? settings.insuranceRatePercent / 100 : contractInsuranceRate(lines, named) ?? 0
  return { costCode, description: named.description, rate }
}

async function contractFeeRates(db: Db, projectId: string): Promise<EstimateBuilderFeeRates> {
  const estimate = await db
    .select({
      overheadRateBasisPoints: projectEstimates.overheadRateBasisPoints,
      marginRateBasisPoints: projectEstimates.marginRateBasisPoints,
      contingencyRateBasisPoints: projectEstimates.contingencyRateBasisPoints,
    })
    .from(projectEstimates)
    .where(and(eq(projectEstimates.projectId, projectId), eq(projectEstimates.status, "accepted"), ...contractEstimateConditions()))
    .orderBy(desc(projectEstimates.versionNumber))
    .get()
  return estimate ?? { overheadRateBasisPoints: 0, marginRateBasisPoints: 0, contingencyRateBasisPoints: 0 }
}

function derivedLineRows(input: {
  readonly projectId: string
  readonly changeOrderId: string
  readonly firstLineNumber: number
  readonly lines: readonly DerivedChangeLine[]
  readonly now: string
}): readonly (typeof projectChangeOrderLines.$inferInsert)[] {
  return input.lines.map((line, index) => ({
    id: crypto.randomUUID(),
    projectId: input.projectId,
    changeOrderId: input.changeOrderId,
    lineNumber: input.firstLineNumber + index,
    description: line.description,
    phaseCode: line.costCode.slice(0, 2),
    costCode: line.costCode,
    amountCents: line.amountCents,
    derivedFrom: line.derivedFrom,
    createdAt: input.now,
    updatedAt: input.now,
  }))
}

/**
 * The insurance line a change order executed from its estimate gets, when the
 * estimate didn't price insurance itself. Empty when the company turned it off
 * or the contract carries no insurance.
 */
export async function changeOrderInsuranceLines(input: {
  readonly db: Db
  readonly projectId: string
  readonly lines: readonly { readonly costCode: string; readonly description: string; readonly amountCents: number }[]
}): Promise<readonly DerivedChangeLine[]> {
  const project = await varianceProject(input.db, input.projectId)
  if (!project) return []
  const insurance = await projectInsuranceRule(input.db, input.projectId, project.settings)
  return derivedChangeLines({
    recordType: "change_order",
    contractType: project.contractType,
    lines: input.lines.map((line) => ({ ...line, derivedFrom: null })),
    feeRates: { overheadRateBasisPoints: 0, marginRateBasisPoints: 0, contingencyRateBasisPoints: 0 },
    insurance,
  })
}

function history(input: {
  readonly projectId: string
  readonly changeOrderId: string
  readonly eventType: string
  readonly fromStatus: ChangeOrderRow["status"] | null
  readonly toStatus: ChangeOrderRow["status"]
  readonly actor: VarianceActor
  readonly note: string | null
  readonly metadata: Record<string, unknown>
  readonly now: string
}): typeof projectChangeOrderHistory.$inferInsert {
  return {
    id: crypto.randomUUID(),
    projectId: input.projectId,
    changeOrderId: input.changeOrderId,
    eventType: input.eventType,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    actorUserId: input.actor.id,
    actorName: activityActorName(input.actor).slice(0, 200),
    actorRole: input.actor.role.slice(0, 80),
    note: input.note,
    metadataJson: JSON.stringify(input.metadata),
    createdAt: input.now,
  }
}

async function numberedRecords(db: Db, projectId: string) {
  return db
    .select({
      id: projectChangeOrders.id,
      changeOrderNumber: projectChangeOrders.changeOrderNumber,
      formerChangeOrderNumber: projectChangeOrders.formerChangeOrderNumber,
      recordType: projectChangeOrders.recordType,
    })
    .from(projectChangeOrders)
    .where(eq(projectChangeOrders.projectId, projectId))
}

/** A new draft variance; staff then enter its cost lines and approve it. */
export async function createVariance(input: {
  readonly db: Db
  readonly projectId: string
  readonly actor: VarianceActor
  readonly title: string
  readonly scope: string
  readonly reason: string | null
  /** What made it, when not staff by hand (a selections round signature). */
  readonly source?: { readonly type: typeof SELECTION_ROUND_VARIANCE_SOURCE; readonly recordId: string }
}): Promise<VarianceResult> {
  const { db, projectId, actor } = input
  const project = await varianceProject(db, projectId)
  if (!project) return { success: false, error: "Project not found." }
  if (project.closed) return { success: false, error: "This project is closed, so it can't change." }
  if (!contractAllowsVariances(project.contractType)) {
    return { success: false, error: `This job is ${contractTypeLabel(project.contractType).toLowerCase()}; price changes go through a change order.` }
  }
  const title = cleanText(input.title)
  const scope = cleanText(input.scope)
  if (!title || title.length > 200) return { success: false, error: "Give the variance a title of up to 200 characters." }
  if (!scope || scope.length > 10_000) return { success: false, error: "Describe the cost movement." }
  const reason = cleanText(input.reason)
  const [number] = nextVarianceNumbers(await numberedRecords(db, projectId), 1)
  if (!number) return { success: false, error: "The variance couldn't be numbered." }
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  await db.batch([
    insertChangeOrderStatement(db, {
      id,
      projectId,
      changeOrderNumber: number,
      recordType: "variance",
      title,
      scope,
      reason: reason ? reason.slice(0, 4_000) : null,
      amountCents: null,
      status: "draft",
      // Owners see approved variances, for information only.
      audience: "owner",
      requesterType: "internal",
      requesterUserId: actor.id,
      requesterName: activityActorName(actor).slice(0, 200),
      sourceType: input.source?.type ?? "internal_request",
      sourceRecordId: input.source?.recordId ?? null,
      budgetTreatment: "additive",
      changeOrderKind: null,
      createdBy: actor.id,
      createdAt: now,
      updatedAt: now,
    }),
    insertChangeOrderHistoryStatement(
      db,
      history({ projectId, changeOrderId: id, eventType: "created", fromStatus: null, toStatus: "draft", actor, note: null, metadata: { recordType: "variance" }, now })
    ),
  ])
  return { success: true, id, budgetNote: null }
}

async function loadVariance(db: Db, projectId: string, changeOrderId: string): Promise<ChangeOrderRow | undefined> {
  return db
    .select()
    .from(projectChangeOrders)
    .where(and(eq(projectChangeOrders.id, changeOrderId), eq(projectChangeOrders.projectId, projectId)))
    .get()
}

/**
 * SQL condition: the variance's typed (not derived) lines are still the ones
 * read. A save replaces every line with new rows stamped with its time, so
 * the count, total and newest stamp change with any save.
 */
function pricedLinesUnchanged(
  changeOrderId: string,
  lines: readonly { readonly amountCents: number | null; readonly createdAt: string }[]
): SQL {
  const typed = and(eq(projectChangeOrderLines.changeOrderId, changeOrderId), isNull(projectChangeOrderLines.derivedFrom))
  const total = lines.reduce((sum, line) => sum + (line.amountCents ?? 0), 0)
  const newest = lines.reduce((max, line) => (line.createdAt > max ? line.createdAt : max), "")
  return sql`(SELECT count(*) = ${lines.length} AND COALESCE(SUM(${projectChangeOrderLines.amountCents}), 0) = ${total}
    AND COALESCE(MAX(${projectChangeOrderLines.createdAt}), '') = ${newest} FROM ${projectChangeOrderLines} WHERE ${typed})`
}

const OPEN_VARIANCE_STATUSES: readonly string[] = ["draft", "submitted", "triage", "needs_information", "pricing", "internal_review"]

/** Replaces a draft variance's cost lines (increases and decreases by cost code). */
export async function saveVarianceLines(input: {
  readonly db: Db
  readonly projectId: string
  readonly changeOrderId: string
  readonly actor: VarianceActor
  readonly lines: readonly VarianceLineInput[]
}): Promise<VarianceResult> {
  const { db, projectId, changeOrderId, actor } = input
  const [project, row, costCodes] = await Promise.all([
    varianceProject(db, projectId),
    loadVariance(db, projectId, changeOrderId),
    loadProjectCostCodeChoices(db, projectId),
  ])
  if (!project || !row || row.recordType !== "variance") return { success: false, error: "Variance not found." }
  if (project.closed) return { success: false, error: "This project is closed, so it can't change." }
  if (!OPEN_VARIANCE_STATUSES.includes(row.status)) return { success: false, error: "Only an unapproved variance's lines can change." }
  const plan = planVarianceLines({ allowedCostCodes: new Set(costCodes.map((choice) => choice.code)), lines: input.lines })
  if (!plan.success) return plan
  const now = new Date().toISOString()
  const amountCents = plan.lines.reduce((sum, line) => sum + line.amountCents, 0)
  const saved = await runGuardedChangeOrderBatch(db, [
    // Not once it was approved meanwhile.
    changeOrderStatusGuardStatement(db, { changeOrderId, projectId, expected: row.status }),
    deleteChangeOrderLinesStatement(db, eq(projectChangeOrderLines.changeOrderId, changeOrderId)),
    insertChangeOrderLineStatement(
      db,
      plan.lines.map((line, index) => ({
        id: crypto.randomUUID(),
        projectId,
        changeOrderId,
        lineNumber: index + 1,
        description: line.description,
        phaseCode: line.costCode.slice(0, 2),
        costCode: line.costCode,
        amountCents: line.amountCents,
        createdAt: now,
        updatedAt: now,
      }))
    ),
    updateChangeOrdersStatement(db, eq(projectChangeOrders.id, changeOrderId), { amountCents, updatedAt: now }),
    insertChangeOrderHistoryStatement(
      db,
      history({ projectId, changeOrderId, eventType: "variance_lines_saved", fromStatus: row.status, toStatus: row.status, actor, note: null, metadata: { lines: plan.lines }, now })
    ),
  ])
  if (!saved) return { success: false, error: "This variance was approved or changed meanwhile. Refresh to see where it stands." }
  return { success: true, id: changeOrderId, budgetNote: null }
}

/**
 * Approves a variance: adds its builder fee (straight cost plus only) and
 * liability insurance lines, executes it without an owner signature, and
 * rebuilds the contract budget so the G703 line it belongs to changes.
 */
export async function approveVariance(input: {
  readonly db: Db
  readonly projectId: string
  readonly changeOrderId: string
  readonly actor: VarianceActor
}): Promise<VarianceResult> {
  const { db, projectId, changeOrderId, actor } = input
  const [project, row] = await Promise.all([varianceProject(db, projectId), loadVariance(db, projectId, changeOrderId)])
  if (!project || !row || row.recordType !== "variance") return { success: false, error: "Variance not found." }
  if (project.closed) return { success: false, error: "This project is closed, so it can't change." }
  if (!contractAllowsVariances(project.contractType)) {
    return { success: false, error: "This job is fixed price; change the price with a change order instead." }
  }
  if (!OPEN_VARIANCE_STATUSES.includes(row.status)) return { success: false, error: "This variance is already approved or closed." }
  const lines = await db
    .select()
    .from(projectChangeOrderLines)
    .where(eq(projectChangeOrderLines.changeOrderId, changeOrderId))
    .orderBy(asc(projectChangeOrderLines.lineNumber))
  const priced = lines.filter((line) => line.derivedFrom === null)
  if (priced.length === 0) return { success: false, error: "Add at least one cost-coded line before approving." }
  if (priced.some((line) => !line.costCode || line.amountCents === null)) {
    return { success: false, error: "Every variance line needs a cost code and amount." }
  }
  const [feeRates, insurance] = await Promise.all([
    contractFeeRates(db, projectId),
    projectInsuranceRule(db, projectId, project.settings),
  ])
  const derived = derivedChangeLines({
    recordType: "variance",
    contractType: project.contractType,
    lines: priced,
    feeRates,
    insurance,
    feeIncluded: row.sourceType === SELECTION_ROUND_VARIANCE_SOURCE,
  })
  const now = new Date().toISOString()
  const amountCents = [...priced, ...derived].reduce((sum, line) => sum + (line.amountCents ?? 0), 0)
  const firstLineNumber = Math.max(0, ...priced.map((line) => line.lineNumber)) + 1
  const statements: [Statement, ...Statement[]] = [
    // Compare-and-set on the status and the priced lines read above: a second
    // approval, or lines saved meanwhile, refuses the whole batch.
    ...changeOrderMoveStatements(db, {
      changeOrderId,
      projectId,
      event: "approve_variance",
      expected: row.status,
      also: pricedLinesUnchanged(changeOrderId, priced),
      values: { executedAt: now, amountCents, budgetTreatment: "additive", updatedAt: now },
    }),
    deleteChangeOrderLinesStatement(
      db,
      and(eq(projectChangeOrderLines.changeOrderId, changeOrderId), isNotNull(projectChangeOrderLines.derivedFrom))
    ),
  ]
  const derivedRows = derivedLineRows({ projectId, changeOrderId, firstLineNumber, lines: derived, now })
  if (derivedRows.length > 0) statements.push(insertChangeOrderLineStatement(db, derivedRows))
  statements.push(
    insertChangeOrderHistoryStatement(
      db,
      history({
        projectId,
        changeOrderId,
        eventType: "variance_approved",
        fromStatus: row.status,
        toStatus: "executed",
        actor,
        note: null,
        metadata: { contractType: project.contractType, amountCents, derived },
        now,
      })
    )
  )
  if (!(await runGuardedChangeOrderBatch(db, statements))) {
    return { success: false, error: "This variance was already approved, or its lines changed meanwhile. Refresh to see where it stands." }
  }
  const budget = await rebuildProjectContractBudget({ db, projectId, actorUserId: actor.id })
  if (project.organizationId) {
    await recordActivityEvent({
      db,
      organizationId: project.organizationId,
      projectId,
      actor,
      category: "financial",
      action: "variance_approved",
      entityType: "project_change_order",
      entityId: changeOrderId,
      summary: `${row.changeOrderNumber} approved: ${row.title}.`,
      metadata: { amountCents },
      createdAt: now,
    })
  }
  return { success: true, id: changeOrderId, budgetNote: budget.success ? null : budget.error }
}

/**
 * Reclassifies change orders as variances (numbered V-001… in date order) or
 * variances back to change orders (their earlier number when it's free).
 * Amounts and lines don't change; the contract budget is rebuilt so pay
 * applications show them in the right G703 column.
 */
export async function reclassifyChangeOrders(input: {
  readonly db: Db
  readonly projectId: string
  readonly changeOrderIds: readonly string[]
  readonly to: ChangeOrderRecordType
  readonly actor: VarianceActor
}): Promise<{ readonly success: true; readonly count: number; readonly budgetNote: string | null } | { readonly success: false; readonly error: string }> {
  const { db, projectId, actor, to } = input
  const ids = [...new Set(input.changeOrderIds)]
  if (ids.length === 0) return { success: false, error: "Choose at least one record." }
  if (ids.length > 50) return { success: false, error: "Reclassify 50 records or fewer at a time." }
  const project = await varianceProject(db, projectId)
  if (!project) return { success: false, error: "Project not found." }
  if (project.closed) return { success: false, error: "This project is closed, so it can't change." }
  if (to === "variance" && !contractAllowsVariances(project.contractType)) {
    return { success: false, error: "This job is fixed price, so it has no variances." }
  }
  const [rows, records, estimates] = await Promise.all([
    db
      .select()
      .from(projectChangeOrders)
      .where(and(eq(projectChangeOrders.projectId, projectId), inArray(projectChangeOrders.id, ids))),
    numberedRecords(db, projectId),
    db
      .select({ changeOrderId: projectEstimates.changeOrderId, status: projectEstimates.status })
      .from(projectEstimates)
      .where(and(eq(projectEstimates.projectId, projectId), inArray(projectEstimates.changeOrderId, ids))),
  ])
  if (rows.length !== ids.length) return { success: false, error: "Some records weren't found on this project." }
  const converting = rows.filter((row) => row.recordType !== to)
  if (converting.length === 0) return { success: true, count: 0, budgetNote: null }
  for (const row of converting) {
    const executed = ["executed", "sage_pending", "synced", "closed"].includes(row.status)
    const problem = reclassificationError({
      to,
      recordType: row.recordType,
      status: row.status,
      kind: row.changeOrderKind,
      budgetTreatment: row.budgetTreatment,
      number: row.changeOrderNumber,
      hasOpenEstimate: !executed && estimates.some((estimate) => estimate.changeOrderId === row.id && estimate.status !== "void"),
    })
    if (problem) return { success: false, error: problem }
  }
  const now = new Date().toISOString()
  const statements: Statement[] = []
  if (to === "variance") {
    for (const { record, number } of varianceNumbersInDateOrder(converting, records)) {
      statements.push(
        updateChangeOrdersStatement(db, eq(projectChangeOrders.id, record.id), {
          recordType: "variance",
          changeOrderNumber: number,
          formerChangeOrderNumber: record.changeOrderNumber,
          // An unexecuted estimate change order becomes one with typed variance lines.
          changeOrderKind: record.changeOrderKind === "estimate" ? null : record.changeOrderKind,
          updatedAt: now,
        }),
        insertChangeOrderHistoryStatement(
          db,
          history({
            projectId,
            changeOrderId: record.id,
            eventType: "reclassified",
            fromStatus: record.status,
            toStatus: record.status,
            actor,
            note: `Reclassified ${record.changeOrderNumber} as variance ${number}.`,
            metadata: { to, previousNumber: record.changeOrderNumber, number },
            now,
          })
        )
      )
    }
  } else {
    // Numbers handed out in this batch count as used for the next one.
    const used = [...records]
    for (const record of converting) {
      const taken = used.some((other) => other.id !== record.id && other.changeOrderNumber === record.formerChangeOrderNumber)
      const number =
        record.formerChangeOrderNumber && !taken ? record.formerChangeOrderNumber : nextChangeOrderNumber(project.projectNumber, used)
      used.push({ id: record.id, changeOrderNumber: number, formerChangeOrderNumber: null, recordType: "change_order" })
      statements.push(
        updateChangeOrdersStatement(db, eq(projectChangeOrders.id, record.id), {
          recordType: "change_order",
          changeOrderNumber: number,
          formerChangeOrderNumber: null,
          updatedAt: now,
        }),
        insertChangeOrderHistoryStatement(
          db,
          history({
            projectId,
            changeOrderId: record.id,
            eventType: "reclassified",
            fromStatus: record.status,
            toStatus: record.status,
            actor,
            note: `Reclassified variance ${record.changeOrderNumber} as change order ${number}.`,
            metadata: { to, previousNumber: record.changeOrderNumber, number },
            now,
          })
        )
      )
    }
  }
  const [first, ...rest] = statements
  if (first) await db.batch([first, ...rest])
  const anyExecuted = converting.some((row) => ["executed", "sage_pending", "synced", "closed"].includes(row.status))
  const budget = anyExecuted ? await rebuildProjectContractBudget({ db, projectId, actorUserId: actor.id }) : null
  return { success: true, count: converting.length, budgetNote: budget && !budget.success ? budget.error : null }
}
