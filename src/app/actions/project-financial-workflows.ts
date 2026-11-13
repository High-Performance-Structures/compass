"use server"

import type { RecordSource } from "@/lib/record-source"
import { loadProjectCostCodeChoices } from "@/lib/cost-codes/catalog-server"

import { requireProjectAudienceReadUser, assertAudiencePreviewWriteAllowed } from "@/lib/project-audience-request-server"
import { canUseProjectAudience } from "@/lib/project-audience-access"

import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  projectBudgetApplications,
  projectBudgetLines,
  projectOperations,
  projects,
} from "@/db/schema"
import {
  projectContractBudgetLines,
  projectContractBudgetRevisions,
} from "@/db/schema-estimates"
import {
  linesWithVariances,
  payApplicationChangeOrders,
  type PayApplicationChangeOrder,
} from "@/lib/financials/pay-application-change-orders"
import { getCloudflareContext } from "@/lib/db"
import { chunkD1InsertRows, isBatchGuardFailure } from "@/lib/d1-query"
import { budgetLineProgress, payApplicationLineEntry, retainageAtPercent, retainageAtRate } from "@/lib/domain/budget/rules"
import { insertOperations, operationDeleteQuery } from "@/lib/domain/operations/store"
import { readListedBills } from "@/lib/domain/financials/receivables"
import { returnPayApplicationToDraft, sendPayApplicationForReview } from "@/lib/domain/budget/pay-application-review"
import { listedBillFor } from "@/lib/domain/financials/rules"
import {
  deleteBudgetApplicationsStatement,
  deleteBudgetLinesStatement,
  discardBudgetApplication,
  draftPayApplicationGuardStatement,
  insertBudgetApplication,
  insertBudgetLines,
  movePayApplicationStatus,
  updateBudgetApplications,
  updateBudgetApplicationsStatement,
  updateBudgetLinesStatement,
  updateDraftPayApplicationLines,
} from "@/lib/domain/budget/store"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import {
  currentWorkForPercent,
  isPayApplicationOwnerDetail,
  type PayApplicationOwnerDetail,
} from "@/lib/financials/pay-application-detail"
import { requireOrg } from "@/lib/org-scope"
import { assertProjectAccess } from "@/lib/domain/project/access"
import { projectMemberRole } from "@/lib/domain/project/member-role"
import { isInternalStaffRole } from "@/lib/user-roles"
import { requirePermission } from "@/lib/permissions"
import {
  assertBilledAmountsEditable,
  availableDepositForApplication,
  refreshAutoDepositPayApplications,
  draftSplitIsStale,
  priorPayApplicationCondition,
  refreshOwnerPayApplication,
  shareLineRow,
  syncDraftPayApplication,
} from "@/lib/financials/owner-pay-application-refresh"
import {
  loadPayApplicationShares,
  priorAmountsForShares,
} from "@/lib/financials/pay-application-shares"
import { linkShopTicketsByNumber } from "@/lib/financials/pay-application-shop-tickets"
import {
  budgetPaymentBreakdown,
  type BudgetPaymentBreakdown,
} from "@/lib/project-budget-snapshot"
import { defaultOwnerDetail, loadOwnerContractEstimate, type DefaultOwnerDetail } from "@/lib/financials/owner-estimate-detail"
import { requireUserContext } from "@/lib/server/action-context"

export type ProjectFinancialWorkflowItem = {
  readonly id: string
  readonly sourceRecordId: string | null
  readonly type:
    | "vendor_bill"
    | "owner_pay_application"
    | "rfq"
    | "owner_invoice"
    | "payment"
    | "deposit"
    | "credit_memo"
  readonly number: string | null
  readonly title: string
  readonly companyName: string | null
  readonly status: string
  readonly amount: number | null
  readonly paymentBreakdown: BudgetPaymentBreakdown | null
  readonly dueDate: string | null
  readonly syncStatus: string
  readonly sageWriteStatus: string
  readonly supportingPackageUrl: string | null
  readonly readOnly: boolean
  /** Short source text for non-Buildertrend sources (e.g. Sage / Square). */
  readonly sourceLabel: string | null
  /** Imported records show the shared source tag, e.g. [BT]. */
  readonly importedFrom: RecordSource | null
  /** The received-payments item this imported record is a copy of; the queue lists it there, not here. */
  readonly shownUnder: string | null
  readonly updatedAt: string
}

export type CreateProjectVendorBillInput = {
  readonly vendorName: string
  readonly billNumber: string | null
  readonly billDate: string | null
  readonly dueDate: string | null
  readonly amount: number | null
  readonly costCode: string | null
  readonly phaseCode: string | null
  readonly description: string | null
}

export type CreateProjectOwnerPayApplicationInput = {
  readonly applicationNumber: string | null
  readonly periodTo: string | null
  readonly amount: number | null
  readonly notes: string | null
  readonly supportingPackageUrl: string | null
}

export type ProjectFinancialPhaseOption = {
  readonly value: string
  readonly label: string
}

export type ProjectFinancialCostCodeOption = {
  readonly onBudget?: boolean; readonly unlisted?: boolean // unlisted: old Sage name with a numbered twin
  readonly value: string
  readonly label: string
  readonly description: string
  readonly divisionCode: string
}

export type ProjectFinancialCodingOptions = {
  readonly phases: readonly ProjectFinancialPhaseOption[]
  readonly costCodes: readonly ProjectFinancialCostCodeOption[]
}

export type ProjectOwnerPayApplicationLine = {
  readonly id: string
  readonly costCode: string
  /** Estimate assembly or change order this row bills; null when none. */
  readonly assemblyKey: string | null
  readonly assemblyName: string | null
  readonly assemblySort: number
  readonly divisionCode: string
  readonly divisionName: string
  readonly description: string
  readonly originalEstimate: number
  readonly priorChanges: number
  readonly currentChanges: number
  readonly totalChanges: number
  /** The part of totalChanges from variances (G703 "Variances"); set on the printed report. */
  readonly totalVariances: number
  readonly adjustedEstimate: number
  readonly previousWorkCompleted: number
  readonly currentWorkCompleted: number
  readonly storedMaterials: number
  readonly totalCompletedStored: number
  readonly retainageHeld: number
  readonly balanceToFinish: number
  readonly ownerVisible: boolean
}

export type ProjectOwnerPayApplicationDraft = {
  readonly id: string
  readonly applicationNumber: string
  readonly periodTo: string | null
  readonly status: string
  /** Set once staff approve the draw for billing. */
  readonly billedAt: string | null
  /** When it last changed; Approve for billing lands only on the version staff saw. */
  readonly updatedAt: string
  readonly sageInvoiceNumber: string | null
  /** Billed amounts entered in Compass, or synced from Sage (read only). */
  readonly billingSource: "compass" | "sage"
  readonly budgetRevisionId: string | null
  readonly originalContractSum: number
  readonly netChanges: number
  readonly contractSumToDate: number
  readonly totalCompletedStoredToDate: number
  readonly retainageHeld: number
  readonly totalEarnedLessRetainage: number
  readonly previousCertificates: number
  /** Contract deposit applied to this draw. */
  readonly depositApplied: number
  readonly depositAppliedMode: "auto" | "manual"
  /** Deposit received and not applied to other pay applications. */
  readonly depositAvailable: number
  readonly currentPaymentDue: number
  readonly balanceToFinish: number
  /** What the client sees on this draw. */
  readonly ownerDetail: PayApplicationOwnerDetail
  /** Detail chosen for this draw; null follows the default below. */
  readonly ownerDetailOverride: PayApplicationOwnerDetail | null
  /** Where the default comes from: the signed estimate, else the company setting. */
  readonly ownerDetailDefault: DefaultOwnerDetail
  /** A newer current contract budget revision this draft has not picked up. */
  readonly newerBudgetRevision: { readonly id: string; readonly revisionNumber: number } | null
  /** The contract budget's assembly split changed since this draft was made. */
  readonly assemblySplitStale: boolean
  readonly lines: readonly ProjectOwnerPayApplicationLine[]
}

type ProjectFinancialWorkflowActionResult =
  | { readonly success: true; readonly id: string }
  | { readonly success: false; readonly error: string }

type ProjectHeader = {
  readonly id: string
  readonly name: string
  readonly sageJobId: string | null
  readonly sageJobNumber: string | null
  readonly organizationId: string
}

async function verifyProjectUpdateAccess(projectId: string): Promise<{
  readonly db: ReturnType<typeof getDb>
  readonly project: ProjectHeader
}> {
  await assertAudiencePreviewWriteAllowed()
  const { user, db } = await requireUserContext()
  requirePermission(user, "project", "update")
  const orgId = requireOrg(user)

  const [project] = await db
    .select({
      id: projects.id,
      name: projects.name,
      sageJobId: projects.sageJobId,
      sageJobNumber: projects.sageJobNumber,
    })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
    .limit(1)

  if (!project) throw new Error("Project not found")
  return { db, project: { ...project, organizationId: orgId } }
}

/** Update access to a pay application whose billed amounts are entered in Compass (not synced from Sage). */
async function billedAmountsAccess(projectId: string, applicationId: string): Promise<ReturnType<typeof getDb>> {
  const { db } = await verifyProjectUpdateAccess(projectId)
  await assertBilledAmountsEditable(db, applicationId)
  return db
}

async function verifyProjectReadAccess(projectId: string): Promise<{
  readonly db: ReturnType<typeof getDb>
  readonly organizationId: string
}> {
  const user = await requireProjectAudienceReadUser(projectId)
  if (!isInternalStaffRole(user.role)) throw new Error("Project not found")
  requirePermission(user, "project", "read")
  const orgId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
    .limit(1)

  if (!project) throw new Error("Project not found")
  return { db, organizationId: orgId }
}

/**
 * Read access to one pay application. Staff read any; a client can read a
 * draw only once it is billed and visible to the owner (checked by the caller).
 */
async function payApplicationReadAccess(projectId: string): Promise<{
  readonly db: ReturnType<typeof getDb>
  readonly organizationId: string
  readonly internal: boolean
}> {
  const user = await requireProjectAudienceReadUser(projectId)
  if (isInternalStaffRole(user.role)) {
    const { db, organizationId } = await verifyProjectReadAccess(projectId)
    return { db, organizationId, internal: true }
  }
  requirePermission(user, "project", "read")
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const project = await assertProjectAccess(db, user, projectId)
  if (!project.organizationId) throw new Error("Project not found")
  const membership = { role: await projectMemberRole(db, user.id, projectId) }
  if (!canUseProjectAudience(membership?.role ?? null, "owner")) throw new Error("Project not found")
  return { db, organizationId: project.organizationId, internal: false }
}

function cleanText(value: string | null): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed.length > 0 ? trimmed : null
}

function requireText(value: string | null, label: string): string {
  const trimmed = value?.trim() ?? ""
  if (trimmed.length === 0) throw new Error(`${label} is required`)
  return trimmed
}

function finiteAmount(value: number | null): number | null {
  if (value === null) return null
  return Number.isFinite(value) ? value : null
}

function safeHttpUrl(value: string | null): string | null {
  const candidate = cleanText(value)
  if (!candidate) return null

  try {
    const url = new URL(candidate)
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null
  } catch {
    return null
  }
}

function prefixForType(type: ProjectFinancialWorkflowItem["type"]): string {
  if (type === "vendor_bill") return "BILL"
  if (type === "owner_pay_application") return "PAYAPP"
  if (type === "owner_invoice") return "INVOICE"
  if (type === "payment") return "PAYMENT"
  if (type === "deposit") return "DEPOSIT"
  if (type === "credit_memo") return "CREDIT"
  return "RFQ"
}

function typeLabel(type: ProjectFinancialWorkflowItem["type"]): string {
  if (type === "vendor_bill") return "Vendor bill"
  if (type === "owner_pay_application") return "Owner pay application"
  if (type === "owner_invoice") return "Owner invoice"
  if (type === "payment") return "Payment"
  if (type === "deposit") return "Deposit"
  if (type === "credit_memo") return "Credit memo"
  return "Request for quote"
}

function financialWorkflowType(
  sourceRecordType: string
): ProjectFinancialWorkflowItem["type"] {
  if (sourceRecordType === "vendor_bill") return "vendor_bill"
  if (sourceRecordType === "owner_pay_application") {
    return "owner_pay_application"
  }
  if (sourceRecordType === "owner_invoice") return "owner_invoice"
  if (sourceRecordType === "payment") return "payment"
  if (sourceRecordType === "deposit") return "deposit"
  if (sourceRecordType === "credit_memo") return "credit_memo"
  return "rfq"
}

async function nextRecordNumber(
  db: ReturnType<typeof getDb>,
  projectId: string,
  type: ProjectFinancialWorkflowItem["type"]
): Promise<string> {
  const rows = await db
    .select({ id: projectOperations.id })
    .from(projectOperations)
    .where(
      and(
        eq(projectOperations.projectId, projectId),
        eq(projectOperations.sourceRecordType, type)
      )
    )
  return `${prefixForType(type)}-${String(rows.length + 1).padStart(3, "0")}`
}

function revalidateFinancialPaths(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}`)
  revalidatePath(`/dashboard/projects/${projectId}/financials`)
  revalidatePath(`/dashboard/projects/${projectId}/rfqs`)
  revalidatePath(`/dashboard/projects/${projectId}/budget`)
  revalidatePath("/dashboard/financials")
  revalidatePath("/dashboard")
}

export async function getProjectFinancialWorkflowItems(
  projectId: string
): Promise<readonly ProjectFinancialWorkflowItem[]> {
  const { db, organizationId } = await verifyProjectReadAccess(projectId)
  const [rows, applications, listedBills] = await Promise.all([
    db
      .select()
      .from(projectOperations)
      .where(
        and(
          eq(projectOperations.projectId, projectId),
          or(
            inArray(projectOperations.sourceRecordType, [
              "vendor_bill",
              "owner_pay_application",
            ]),
            // Verified cutover rows are promoted here for operational use;
            // staging remains the immutable source-evidence layer.
            and(
              inArray(projectOperations.sourceSystem, ["buildertrend", "sage"]),
              inArray(projectOperations.sourceRecordType, [
                "owner_invoice",
                "payment",
                "deposit",
                "credit_memo",
              ])
            )
          )
        )
      )
      .orderBy(
        asc(
          sql`coalesce(${projectOperations.dueDate}, ${projectOperations.startDate}, ${projectOperations.createdAt})`
        ),
        asc(projectOperations.updatedAt)
      ),
    db
      .select({
        id: projectBudgetApplications.id,
        sourceRecordId: projectBudgetApplications.sourceRecordId,
        totalEarnedLessRetainage:
          projectBudgetApplications.totalEarnedLessRetainage,
        previousCertificates: projectBudgetApplications.previousCertificates,
        currentPaymentDue: projectBudgetApplications.currentPaymentDue,
        sourceUrl: projectBudgetApplications.sourceUrl,
      })
      .from(projectBudgetApplications)
      .where(eq(projectBudgetApplications.projectId, projectId)),
    readListedBills(db, { organizationId, projectId }),
  ])
  const applicationsBySourceId = new Map(
    applications.flatMap((application) => {
      const keys = [application.id, application.sourceRecordId].filter(
        (value): value is string => Boolean(value)
      )
      return keys.map((key) => [key, application] as const)
    })
  )

  return rows.map((row) => {
    const isReadOnlyImportedFinancial =
      ["buildertrend", "sage"].includes(row.sourceSystem) &&
      ["owner_invoice", "payment", "deposit", "credit_memo"].includes(
        row.sourceRecordType
      )
    const application =
      row.sourceRecordType === "owner_pay_application" && row.sourceRecordId
        ? applicationsBySourceId.get(row.sourceRecordId) ?? null
        : null
    const paymentBreakdown = application
      ? budgetPaymentBreakdown(application)
      : null

    return {
      id: row.id,
      sourceRecordId: row.sourceRecordId,
      type: financialWorkflowType(row.sourceRecordType),
      number: row.sourceRecordNumber,
      title: row.title,
      companyName: row.companyName,
      status: row.status,
      amount: paymentBreakdown?.applicationTotal ?? row.amount,
      paymentBreakdown,
      dueDate:
        row.dueDate ??
        (isReadOnlyImportedFinancial
          ? row.startDate ?? row.createdAt.slice(0, 10)
          : null),
      syncStatus: row.syncStatus,
      sageWriteStatus: row.sageWriteStatus,
      supportingPackageUrl:
        safeHttpUrl(row.externalUrl) ??
        safeHttpUrl(application?.sourceUrl ?? null),
      readOnly: isReadOnlyImportedFinancial,
      sourceLabel: row.sourceSystem === "sage" ? "Sage / Square" : null,
      importedFrom: row.sourceSystem.startsWith("buildertrend") ? "buildertrend" : null,
      // An imported copy of a bill listed with received payments (the queue shows it there).
      shownUnder: listedBillFor(row, listedBills)?.label ?? null,
      updatedAt: row.updatedAt,
    }
  })
}

async function newerBudgetRevision(
  db: ReturnType<typeof getDb>,
  projectId: string,
  budgetRevisionId: string | null
): Promise<{ readonly id: string; readonly revisionNumber: number } | null> {
  const current = await db
    .select({
      id: projectContractBudgetRevisions.id,
      revisionNumber: projectContractBudgetRevisions.revisionNumber,
    })
    .from(projectContractBudgetRevisions)
    .where(
      and(
        eq(projectContractBudgetRevisions.projectId, projectId),
        eq(projectContractBudgetRevisions.status, "current")
      )
    )
    .get()
  return current && current.id !== budgetRevisionId ? current : null
}

export async function getProjectOwnerPayApplicationDraft(
  projectId: string,
  applicationId: string
): Promise<ProjectOwnerPayApplicationDraft | null> {
  const { db, organizationId, internal } = await payApplicationReadAccess(projectId)
  const applicationRows = await db
    .select()
    .from(projectBudgetApplications)
    .where(
      and(
        eq(projectBudgetApplications.id, applicationId),
        eq(projectBudgetApplications.projectId, projectId),
        eq(projectBudgetApplications.sourceSystem, "compass_contract_budget")
      )
    )
    .limit(1)
  const application = applicationRows[0]
  if (!application) return null
  if (!internal && !(application.ownerVisible && application.status === "billed")) return null
  const lines = await db
    .select()
    .from(projectBudgetLines)
    .where(and(eq(projectBudgetLines.projectId, projectId), eq(projectBudgetLines.applicationId, applicationId)))
    .orderBy(asc(projectBudgetLines.csiDivision), asc(projectBudgetLines.sortOrder))

  const ownerDetailDefault = await defaultOwnerDetail(db, organizationId, await loadOwnerContractEstimate(db, projectId, application.budgetRevisionId))
  return {
    id: application.id,
    applicationNumber: application.applicationNumber,
    periodTo: application.periodTo,
    status: application.status,
    billedAt: application.billedAt,
    updatedAt: application.updatedAt,
    sageInvoiceNumber: application.sageInvoiceNumber,
    billingSource: application.billingSource,
    budgetRevisionId: application.budgetRevisionId,
    originalContractSum: application.originalContractSum,
    netChanges: application.netChanges,
    contractSumToDate: application.contractSumToDate,
    totalCompletedStoredToDate: application.totalCompletedStoredToDate,
    retainageHeld: application.retainageHeld,
    totalEarnedLessRetainage: application.totalEarnedLessRetainage,
    previousCertificates: application.previousCertificates,
    depositApplied: application.depositApplied,
    depositAppliedMode: application.depositAppliedMode === "manual" ? "manual" : "auto",
    depositAvailable: await availableDepositForApplication(db, projectId, applicationId),
    currentPaymentDue: application.currentPaymentDue,
    balanceToFinish: application.balanceToFinish,
    ownerDetail: isPayApplicationOwnerDetail(application.ownerDetail)
      ? application.ownerDetail
      : ownerDetailDefault.detail,
    ownerDetailDefault,
    ownerDetailOverride: isPayApplicationOwnerDetail(application.ownerDetail)
      ? application.ownerDetail
      : null,
    newerBudgetRevision:
      application.status === "draft" ? await newerBudgetRevision(db, projectId, application.budgetRevisionId) : null,
    assemblySplitStale:
      application.status === "draft" && application.budgetRevisionId
        ? draftSplitIsStale(lines, await loadPayApplicationShares(db, application.budgetRevisionId))
        : false,
    lines: lines.map((line) => ({
      id: line.id,
      costCode: line.costCode,
      assemblyKey: line.assemblyKey,
      assemblyName: line.assemblyName,
      assemblySort: line.assemblySort,
      divisionCode: line.csiDivision,
      divisionName: line.csiDivisionName,
      description: line.description,
      originalEstimate: line.originalEstimate,
      priorChanges: line.priorChanges,
      currentChanges: line.currentChanges,
      totalChanges: line.totalChanges,
      totalVariances: 0,
      adjustedEstimate: line.adjustedEstimate,
      previousWorkCompleted: line.previousWorkCompleted,
      currentWorkCompleted: line.currentWorkCompleted,
      storedMaterials: line.storedMaterials,
      totalCompletedStored: line.totalCosts,
      retainageHeld: line.retainageHeld,
      balanceToFinish: line.balanceToFinish,
      ownerVisible: line.ownerVisible,
    })),
  }
}

export type ProjectOwnerPayApplicationReport = {
  readonly draft: ProjectOwnerPayApplicationDraft
  /** Executed change orders in this contract budget, split by assembly. */
  readonly changeOrders: readonly PayApplicationChangeOrder[]
  readonly project: {
    readonly name: string
    readonly projectNumber: string | null
    readonly department: string | null
    readonly address: string | null
    readonly clientName: string | null
    readonly clientAddress: string | null
  }
}

/** A pay application with the project details its G702/G703 print needs. */
export async function getProjectOwnerPayApplicationReport(
  projectId: string,
  applicationId: string
): Promise<ProjectOwnerPayApplicationReport | null> {
  const draft = await getProjectOwnerPayApplicationDraft(projectId, applicationId)
  if (!draft) return null
  const { db } = await payApplicationReadAccess(projectId)
  const project = await db
    .select({
      name: projects.name,
      projectNumber: projects.projectNumber,
      department: projects.department,
      address: projects.address,
      clientName: projects.clientName,
      clientAddress: projects.mailingAddress,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get()
  if (!project) return null
  const [changeOrders, lines] = await Promise.all([
    payApplicationChangeOrders(db, { projectId, applicationId, budgetRevisionId: draft.budgetRevisionId }),
    linesWithVariances(db, draft.budgetRevisionId, draft.lines),
  ])
  return { draft: { ...draft, lines }, project, changeOrders }
}

function nonnegativeAmount(value: number | null, label: string): number {
  if (value === null || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be zero or greater.`)
  }
  return Math.round(value * 100) / 100
}

export async function updateProjectOwnerPayApplicationLine(
  projectId: string,
  applicationId: string,
  lineId: string,
  input: {
    readonly currentWorkCompleted: number | null
    readonly storedMaterials: number | null
    readonly retainagePercent: number | null
    readonly ownerVisible: boolean
  }
): Promise<ProjectFinancialWorkflowActionResult> {
  try {
    const db = await billedAmountsAccess(projectId, applicationId)
    const applicationRows = await db
      .select({ status: projectBudgetApplications.status })
      .from(projectBudgetApplications)
      .where(
        and(
          eq(projectBudgetApplications.id, applicationId),
          eq(projectBudgetApplications.projectId, projectId),
          eq(projectBudgetApplications.sourceSystem, "compass_contract_budget")
        )
      )
      .limit(1)
    if (applicationRows[0]?.status !== "draft") {
      throw new Error("Only a draft pay application can be edited.")
    }
    const lineRows = await db
      .select()
      .from(projectBudgetLines)
      .where(
        and(
          eq(projectBudgetLines.id, lineId),
          eq(projectBudgetLines.applicationId, applicationId),
          eq(projectBudgetLines.projectId, projectId)
        )
      )
      .limit(1)
    const line = lineRows[0]
    if (!line) throw new Error("Pay application line not found.")
    const checked = payApplicationLineEntry({
      previousWorkCompleted: line.previousWorkCompleted,
      adjustedEstimate: line.adjustedEstimate,
      currentWorkCompleted: input.currentWorkCompleted,
      storedMaterials: input.storedMaterials,
      retainagePercent: input.retainagePercent,
    })
    if (!checked.success) return { success: false, error: checked.error }
    const { currentWorkCompleted, storedMaterials, retainagePercent, totalCompletedStored } =
      checked.entry
    const retainageHeld = retainageAtPercent(totalCompletedStored, retainagePercent)
    const now = new Date().toISOString()
    // Lands only while the draw is still a draft (not sent to review meanwhile).
    const changed = await updateDraftPayApplicationLines(db, {
      projectId,
      applicationId,
      where: eq(projectBudgetLines.id, lineId),
      patch: {
        currentWorkCompleted,
        storedMaterials,
        ...budgetLineProgress({
          previousWorkCompleted: line.previousWorkCompleted,
          currentWorkCompleted,
          storedMaterials,
          adjustedEstimate: line.adjustedEstimate,
        }),
        retainageHeld,
        ownerVisible: input.ownerVisible,
        updatedAt: now,
      },
    })
    if (changed === 0) throw new Error("Only a draft pay application can be edited.")
    await refreshOwnerPayApplication(db, projectId, applicationId, now)
    revalidateFinancialPaths(projectId)
    return { success: true, id: lineId }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to update pay application." }
  }
}

/**
 * Bill a whole division, or one cost code, to a percent complete to date.
 * Each line's current work becomes that percent of its scheduled value less
 * previous work and stored materials; retainage keeps each line's rate.
 */
export async function setProjectOwnerPayApplicationPercentComplete(
  projectId: string,
  applicationId: string,
  input: {
    readonly scope: "division" | "assembly" | "cost_code" | "line"
    /** Division code, assembly key ("" for work outside any assembly), cost code, or line id. */
    readonly key: string
    readonly percentComplete: number | null
  }
): Promise<ProjectFinancialWorkflowActionResult> {
  try {
    const db = await billedAmountsAccess(projectId, applicationId)
    const application = await db
      .select({ id: projectBudgetApplications.id })
      .from(projectBudgetApplications)
      .where(
        and(
          eq(projectBudgetApplications.id, applicationId),
          eq(projectBudgetApplications.projectId, projectId),
          eq(projectBudgetApplications.sourceSystem, "compass_contract_budget"),
          eq(projectBudgetApplications.status, "draft")
        )
      )
      .get()
    if (!application) throw new Error("Only a draft pay application can be edited.")
    if (input.percentComplete === null) throw new Error("Enter a percent complete.")
    const percentComplete = input.percentComplete
    const lines = await db
      .select()
      .from(projectBudgetLines)
      .where(
        and(
          eq(projectBudgetLines.projectId, projectId),
          eq(projectBudgetLines.applicationId, applicationId),
          input.scope === "division"
            ? eq(projectBudgetLines.csiDivision, input.key)
            : input.scope === "assembly"
              ? input.key
                ? eq(projectBudgetLines.assemblyKey, input.key)
                : isNull(projectBudgetLines.assemblyKey)
              : input.scope === "cost_code"
                ? eq(projectBudgetLines.costCode, input.key)
                : eq(projectBudgetLines.id, input.key)
        )
      )
    if (lines.length === 0) throw new Error("No pay application lines match.")
    const now = new Date().toISOString()
    const updates = lines.map((line) => {
      const result = currentWorkForPercent(line, percentComplete)
      if (!result.success) throw new Error(result.error)
      const progress = budgetLineProgress({ ...line, currentWorkCompleted: result.currentWorkCompleted })
      const retainageRate = line.totalCosts > 0 ? line.retainageHeld / line.totalCosts : 0
      return updateBudgetLinesStatement(db, eq(projectBudgetLines.id, line.id), {
        currentWorkCompleted: result.currentWorkCompleted,
        ...progress,
        retainageHeld: retainageAtRate(progress.totalCosts, retainageRate),
        updatedAt: now,
      })
    })
    try {
      // Only while the draw is still a draft (not sent to review meanwhile).
      await db.batch([draftPayApplicationGuardStatement(db, projectId, applicationId), ...updates])
    } catch (error) {
      if (isBatchGuardFailure(error)) throw new Error("Only a draft pay application can be edited.")
      throw error
    }
    await refreshOwnerPayApplication(db, projectId, applicationId, now)
    revalidateFinancialPaths(projectId)
    return { success: true, id: applicationId }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to bill by percent complete." }
  }
}

/** Choose what the client sees on one pay application; null follows the company default. */
export async function setProjectOwnerPayApplicationOwnerDetail(
  projectId: string,
  applicationId: string,
  ownerDetail: PayApplicationOwnerDetail | null
): Promise<ProjectFinancialWorkflowActionResult> {
  try {
    const { db } = await verifyProjectUpdateAccess(projectId)
    if (ownerDetail !== null && !isPayApplicationOwnerDetail(ownerDetail)) {
      throw new Error("Choose a client detail level.")
    }
    const application = await db
      .select({ id: projectBudgetApplications.id })
      .from(projectBudgetApplications)
      .where(
        and(
          eq(projectBudgetApplications.id, applicationId),
          eq(projectBudgetApplications.projectId, projectId),
          eq(projectBudgetApplications.sourceSystem, "compass_contract_budget")
        )
      )
      .get()
    if (!application) throw new Error("Pay application not found.")
    await updateBudgetApplications(db, eq(projectBudgetApplications.id, applicationId), {
      ownerDetail,
      updatedAt: new Date().toISOString(),
    })
    revalidateFinancialPaths(projectId)
    return { success: true, id: applicationId }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to change the client detail." }
  }
}

/**
 * Move a draft pay application onto the current contract budget revision,
 * keeping the work already entered, so executed change orders are billed.
 */
export async function updateProjectOwnerPayApplicationBudget(
  projectId: string,
  applicationId: string
): Promise<ProjectFinancialWorkflowActionResult> {
  try {
    const db = await billedAmountsAccess(projectId, applicationId)
    const application = await db
      .select({ budgetRevisionId: projectBudgetApplications.budgetRevisionId })
      .from(projectBudgetApplications)
      .where(
        and(
          eq(projectBudgetApplications.id, applicationId),
          eq(projectBudgetApplications.projectId, projectId),
          eq(projectBudgetApplications.sourceSystem, "compass_contract_budget"),
          eq(projectBudgetApplications.status, "draft")
        )
      )
      .get()
    if (!application) throw new Error("Only a draft pay application can be updated.")
    // The newer current revision, or the draft's own revision when only its
    // assembly split changed.
    const newer = await newerBudgetRevision(db, projectId, application.budgetRevisionId)
    const targetRevisionId = newer?.id ?? application.budgetRevisionId
    if (!targetRevisionId) throw new Error("This pay application has no contract budget revision.")
    if (!(await syncDraftPayApplication(db, projectId, applicationId, targetRevisionId, new Date().toISOString()))) {
      throw new Error("Only a draft pay application can be updated.")
    }
    revalidateFinancialPaths(projectId)
    return { success: true, id: applicationId }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to update the pay application." }
  }
}

/** Delete a draft pay application. Submitted ones are kept for the record. */
export async function deleteProjectOwnerPayApplicationDraft(
  projectId: string,
  applicationId: string
): Promise<ProjectFinancialWorkflowActionResult> {
  try {
    const { db } = await verifyProjectUpdateAccess(projectId)
    const application = await db
      .select({ id: projectBudgetApplications.id })
      .from(projectBudgetApplications)
      .where(
        and(
          eq(projectBudgetApplications.id, applicationId),
          eq(projectBudgetApplications.projectId, projectId),
          eq(projectBudgetApplications.sourceSystem, "compass_contract_budget"),
          eq(projectBudgetApplications.status, "draft")
        )
      )
      .get()
    if (!application) throw new Error("Only a draft pay application can be deleted.")
    try {
      await db.batch([
        // Not once it went to review meanwhile.
        draftPayApplicationGuardStatement(db, projectId, applicationId),
        deleteBudgetLinesStatement(db, eq(projectBudgetLines.applicationId, applicationId)),
        operationDeleteQuery(
          db,
          and(
            eq(projectOperations.projectId, projectId),
            eq(projectOperations.sourceRecordType, "owner_pay_application"),
            eq(projectOperations.sourceRecordId, applicationId)
          )
        ),
        deleteBudgetApplicationsStatement(db, eq(projectBudgetApplications.id, applicationId)),
      ])
    } catch (error) {
      if (isBatchGuardFailure(error)) throw new Error("Only a draft pay application can be deleted.")
      throw error
    }
    // Its applied deposit is free again for the other drafts.
    await refreshAutoDepositPayApplications(db, projectId, new Date().toISOString())
    revalidateFinancialPaths(projectId)
    return { success: true, id: applicationId }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to delete the pay application." }
  }
}

/**
 * Set how much contract deposit a draft pay application applies: "auto"
 * applies the available balance up to the draw; "manual" uses the amount.
 */
export async function setProjectOwnerPayApplicationDeposit(
  projectId: string,
  applicationId: string,
  input: { readonly mode: "auto" | "manual"; readonly amount: number | null }
): Promise<ProjectFinancialWorkflowActionResult> {
  try {
    const db = await billedAmountsAccess(projectId, applicationId)
    const application = await db
      .select({ id: projectBudgetApplications.id })
      .from(projectBudgetApplications)
      .where(
        and(
          eq(projectBudgetApplications.id, applicationId),
          eq(projectBudgetApplications.projectId, projectId),
          eq(projectBudgetApplications.status, "draft")
        )
      )
      .get()
    if (!application) throw new Error("Draft pay application not found.")
    const amount = input.mode === "manual" ? nonnegativeAmount(input.amount, "Deposit applied") : 0
    const now = new Date().toISOString()
    try {
      await db.batch([
        // A draw sent to review keeps the deposit it was reviewed with.
        draftPayApplicationGuardStatement(db, projectId, applicationId),
        updateBudgetApplicationsStatement(db, eq(projectBudgetApplications.id, applicationId), {
          depositAppliedMode: input.mode,
          depositApplied: amount,
          updatedAt: now,
        }),
      ])
    } catch (error) {
      if (isBatchGuardFailure(error)) throw new Error("Draft pay application not found.")
      throw error
    }
    await refreshOwnerPayApplication(db, projectId, applicationId, now)
    revalidateFinancialPaths(projectId)
    return { success: true, id: applicationId }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to apply the deposit." }
  }
}

export async function markProjectOwnerPayApplicationReady(
  projectId: string,
  applicationId: string
): Promise<ProjectFinancialWorkflowActionResult> {
  try {
    const { db } = await verifyProjectUpdateAccess(projectId)
    await sendPayApplicationForReview(db, { projectId, applicationId, now: new Date().toISOString() })
    revalidateFinancialPaths(projectId)
    return { success: true, id: applicationId }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to stage Sage review." }
  }
}

/**
 * Send a pay application in internal review back to draft so it can be edited
 * again. Only before anyone has moved it past internal review.
 */
export async function returnProjectOwnerPayApplicationToDraft(
  projectId: string,
  applicationId: string
): Promise<ProjectFinancialWorkflowActionResult> {
  try {
    const { db } = await verifyProjectUpdateAccess(projectId)
    await returnPayApplicationToDraft(db, { projectId, applicationId, now: new Date().toISOString() })
    revalidateFinancialPaths(projectId)
    return { success: true, id: applicationId }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to return the pay application to draft." }
  }
}

export async function getProjectFinancialCodingOptions(
  projectId: string
): Promise<ProjectFinancialCodingOptions> {
  const { db } = await verifyProjectReadAccess(projectId)
  const sageRows = await loadProjectCostCodeChoices(db, projectId)
  const phases = new Map<string, ProjectFinancialPhaseOption>()
  const costCodes = new Map<string, ProjectFinancialCostCodeOption>()

  for (const row of sageRows) {
    phases.set(row.divisionCode, {
      value: row.divisionCode,
      label: row.divisionDisplayLabel,
    })
    costCodes.set(row.code, {
      value: row.code,
      onBudget: row.onBudget,
      label: row.displayLabel,
      description: row.description,
      divisionCode: row.divisionCode, unlisted: !row.listed,
    })
  }

  return {
    phases: Array.from(phases.values()).sort((left, right) =>
      left.label.localeCompare(right.label)
    ),
    costCodes: Array.from(costCodes.values()).sort((left, right) =>
      left.label.localeCompare(right.label)
    ),
  }
}

export async function createProjectVendorBillDraft(
  projectId: string,
  input: CreateProjectVendorBillInput
): Promise<ProjectFinancialWorkflowActionResult> {
  try {
    const { db, project } = await verifyProjectUpdateAccess(projectId)
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const vendorName = requireText(input.vendorName, "Vendor")
    const billDate = cleanText(input.billDate)
    const dueDate = cleanText(input.dueDate)
    const amount = finiteAmount(input.amount)
    const recordNumber =
      cleanText(input.billNumber) ??
      (await nextRecordNumber(db, projectId, "vendor_bill"))
    const description =
      cleanText(input.description) ?? `${vendorName} vendor bill`

    await insertOperations(db, {
      id,
      projectId,
      sourceSystem: "compass",
      sourceRecordType: "vendor_bill",
      sourceRecordNumber: recordNumber,
      title: `${vendorName} - ${recordNumber}`,
      description,
      status: "draft",
      priority: "normal",
      assigneeType: "vendor",
      companyName: vendorName,
      costCode: cleanText(input.costCode),
      startDate: billDate,
      dueDate,
      amount,
      sageJobId: project.sageJobId,
      sageJobNumber: project.sageJobNumber,
      sageVendorName: vendorName,
      sagePhaseCode: cleanText(input.phaseCode),
      sageCostCode: cleanText(input.costCode),
      sageWriteStatus: "draft_ready",
      sagePayloadJson: JSON.stringify({
        source: "compass_vendor_bill",
        projectName: project.name,
        jobId: project.sageJobId,
        jobNumber: project.sageJobNumber,
        vendorName,
        billNumber: recordNumber,
        billDate,
        dueDate,
        amount,
        phaseCode: cleanText(input.phaseCode),
        costCode: cleanText(input.costCode),
        description,
      }),
      syncDirection: "write",
      syncStatus: "compass_only",
      createdAt: now,
      updatedAt: now,
    })

    revalidateFinancialPaths(projectId)
    return { success: true, id }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to stage vendor bill" }
  }
}

export async function createProjectOwnerPayApplicationDraft(
  projectId: string,
  input: CreateProjectOwnerPayApplicationInput
): Promise<ProjectFinancialWorkflowActionResult> {
  try {
    const { db, project } = await verifyProjectUpdateAccess(projectId)
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const applicationId = crypto.randomUUID()
    const recordNumber =
      cleanText(input.applicationNumber) ??
      (await nextRecordNumber(db, projectId, "owner_pay_application"))
    const periodTo = cleanText(input.periodTo)
    const revisionRows = await db
      .select()
      .from(projectContractBudgetRevisions)
      .where(
        and(
          eq(projectContractBudgetRevisions.projectId, projectId),
          eq(projectContractBudgetRevisions.status, "current")
        )
      )
      .orderBy(desc(projectContractBudgetRevisions.revisionNumber))
      .limit(1)
    const revision = revisionRows[0]
    if (!revision) {
      throw new Error(
        "Accept the signed estimate and build the contract budget before creating a pay application."
      )
    }
    const revisionLines = await db
      .select()
      .from(projectContractBudgetLines)
      .where(eq(projectContractBudgetLines.revisionId, revision.id))
      .orderBy(
        asc(projectContractBudgetLines.divisionCode),
        asc(projectContractBudgetLines.sortOrder)
      )
    if (revisionLines.length === 0) {
      throw new Error("The current contract budget has no lines.")
    }
    const duplicateRows = await db
      .select({
        id: projectBudgetApplications.id,
        status: projectBudgetApplications.status,
      })
      .from(projectBudgetApplications)
      .where(
        and(
          eq(projectBudgetApplications.projectId, projectId),
          eq(projectBudgetApplications.applicationNumber, recordNumber)
        )
      )
      .limit(1)
    const duplicate = duplicateRows[0]
    if (duplicate) {
      // A "building" row with no workflow operation is left over from a
      // create that failed partway; clear it so the number can be reused.
      const operationRows =
        duplicate.status === "building"
          ? await db
              .select({ id: projectOperations.id })
              .from(projectOperations)
              .where(
                and(
                  eq(projectOperations.projectId, projectId),
                  eq(projectOperations.sourceRecordId, duplicate.id)
                )
              )
              .limit(1)
          : []
      if (duplicate.status !== "building" || operationRows[0]) {
        throw new Error("That pay application number already exists.")
      }
      await discardBudgetApplication(db, duplicate.id)
    }
    const priorApplications = await db
      .select()
      .from(projectBudgetApplications)
      .where(priorPayApplicationCondition(projectId))
      .orderBy(
        desc(projectBudgetApplications.periodTo),
        desc(projectBudgetApplications.createdAt)
      )
      .limit(1)
    const priorApplication = priorApplications[0]
    const priorLines = priorApplication
      ? await db
          .select()
          .from(projectBudgetLines)
          .where(eq(projectBudgetLines.applicationId, priorApplication.id))
      : []
    const originalContractSum = revision.originalContractSumCents / 100
    const netChanges = revision.approvedChangesCents / 100
    const contractSumToDate = revision.revisedContractSumCents / 100
    const previousCertificates =
      priorApplication?.totalEarnedLessRetainage ?? 0
    const depositSettings = await readFeatureSettings(db, project.organizationId, "contract-deposits")
    const priorCompletedStored =
      priorApplication?.totalCompletedStoredToDate ?? 0
    const priorRetainage = priorApplication?.retainageHeld ?? 0

    await insertBudgetApplication(db, {
      id: applicationId,
      projectId,
      sourceSystem: "compass_contract_budget",
      sourceRecordId: revision.id,
      applicationNumber: recordNumber,
      periodTo,
      status: "building",
      depositAppliedMode: depositSettings.autoApplyToPayApplications ? "auto" : "manual",
      originalContractSum,
      netChanges,
      contractSumToDate,
      totalCompletedStoredToDate: priorCompletedStored,
      retainageHeld: priorRetainage,
      totalEarnedLessRetainage: previousCertificates,
      previousCertificates,
      currentPaymentDue: 0,
      balanceToFinish: contractSumToDate - previousCertificates,
      ownerVisible: false,
      sourceUrl: safeHttpUrl(input.supportingPackageUrl),
      budgetRevisionId: revision.id,
      syncStatus: "compass_only",
      lastSyncedAt: null,
      createdAt: now,
      updatedAt: now,
    })

    const shares = await loadPayApplicationShares(db, revision.id)
    const priorAmounts = priorAmountsForShares(shares, priorLines)
    const applicationLineRows = shares.map((share, index) =>
      shareLineRow(
        share,
        { projectId, applicationId, revisionNumber: revision.revisionNumber, now },
        {
          previousWorkCompletedCents: priorAmounts[index]?.previousCents ?? 0,
          currentWorkCompletedCents: 0,
          storedMaterialsCents: 0,
          retainageHeldCents: priorAmounts[index]?.retainageCents ?? 0,
          priorChangesCents: priorAmounts[index]?.priorChangesCents ?? 0,
        }
      )
    )
    try {
      for (const rows of chunkD1InsertRows(projectBudgetLines, applicationLineRows)) {
        await insertBudgetLines(db, rows)
      }
    } catch (error) {
      await discardBudgetApplication(db, applicationId)
      throw error
    }

    await insertOperations(db, {
      id,
      projectId,
      sourceSystem: "compass",
      sourceRecordType: "owner_pay_application",
      sourceRecordId: applicationId,
      sourceRecordNumber: recordNumber,
      title: `${typeLabel("owner_pay_application")} ${recordNumber}`,
      description: cleanText(input.notes),
      status: "draft",
      priority: "normal",
      assigneeType: "owner",
      dueDate: periodTo,
      amount: 0,
      externalUrl: safeHttpUrl(input.supportingPackageUrl),
      sageJobId: project.sageJobId,
      sageJobNumber: project.sageJobNumber,
      sageWriteStatus: "draft_ready",
      sagePayloadJson: JSON.stringify({
        source: "compass_owner_pay_application",
        projectName: project.name,
        jobId: project.sageJobId,
        jobNumber: project.sageJobNumber,
        applicationNumber: recordNumber,
        periodTo,
        amount: 0,
        budgetRevisionId: revision.id,
        budgetRevisionNumber: revision.revisionNumber,
        originalContractSum,
        netChanges,
        contractSumToDate,
        previousCertificates,
        lineCount: revisionLines.length,
        notes: cleanText(input.notes),
        supportingPackageUrl: safeHttpUrl(input.supportingPackageUrl),
        format: "AIA_G702_G703_STYLE",
      }),
      syncDirection: "write",
      // A draft is not a Sage write request. The reviewed G702/G703 snapshot
      // is staged separately and still requires explicit write approval.
      syncStatus: "compass_only",
      createdAt: now,
      updatedAt: now,
    })
    if (!(await movePayApplicationStatus(db, { projectId, applicationId, event: "finish", values: { updatedAt: now } }))) {
      throw new Error("The pay application changed while it was being created. Refresh and try again.")
    }
    await linkShopTicketsByNumber(db, projectId, applicationId) // issued tickets naming this number
    revalidateFinancialPaths(projectId)
    return { success: true, id }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to create owner pay application" }
  }
}
