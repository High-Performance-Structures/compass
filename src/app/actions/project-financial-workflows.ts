"use server"

import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  projectBudgetApplications,
  projectBudgetLines,
  projectOperations,
  projects,
  sageCostCodes,
} from "@/db/schema"
import {
  projectContractBudgetLines,
  projectContractBudgetRevisions,
} from "@/db/schema-estimates"
import { requireAuth } from "@/lib/auth"
import {
  payApplicationChangeOrders,
  type PayApplicationChangeOrder,
} from "@/lib/financials/pay-application-change-orders"
import { getCloudflareContext } from "@/lib/db"
import { chunkD1Rows } from "@/lib/d1-query"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import {
  currentWorkForPercent,
  isPayApplicationOwnerDetail,
  type PayApplicationOwnerDetail,
} from "@/lib/financials/pay-application-detail"
import { requireOrg } from "@/lib/org-scope"
import { assertProjectAccess } from "@/lib/project-access"
import { isInternalStaffRole } from "@/lib/user-roles"
import { requirePermission } from "@/lib/permissions"
import {
  availableDepositForApplication,
  refreshAutoDepositPayApplications,
  draftSplitIsStale,
  refreshOwnerPayApplication,
  shareLineRow,
  syncDraftPayApplication,
} from "@/lib/financials/owner-pay-application-refresh"
import {
  g703ByCostCode,
  loadPayApplicationShares,
  priorAmountsForShares,
} from "@/lib/financials/pay-application-shares"
import {
  budgetPaymentBreakdown,
  type BudgetPaymentBreakdown,
} from "@/lib/project-budget-snapshot"

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
  readonly sourceLabel: string | null
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

export type CreateProjectRfqInput = {
  readonly title: string
  readonly vendorCategory: string | null
  readonly requestedFrom: string | null
  readonly responseDueDate: string | null
  readonly priority: string
  readonly scope: string | null
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
  readonly sageInvoiceNumber: string | null
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
  /** Detail chosen for this draw; null follows the company default. */
  readonly ownerDetailOverride: PayApplicationOwnerDetail | null
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
  const user = await requireAuth()
  requirePermission(user, "project", "update")
  const orgId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

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

async function verifyProjectReadAccess(projectId: string): Promise<{
  readonly db: ReturnType<typeof getDb>
  readonly organizationId: string
}> {
  const user = await requireAuth()
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
  const user = await requireAuth()
  if (isInternalStaffRole(user.role)) {
    const { db, organizationId } = await verifyProjectReadAccess(projectId)
    return { db, organizationId, internal: true }
  }
  requirePermission(user, "project", "read")
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const project = await assertProjectAccess(db, user, projectId)
  if (!project.organizationId) throw new Error("Project not found")
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
  const { db } = await verifyProjectReadAccess(projectId)
  const [rows, applications] = await Promise.all([
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
      sourceLabel:
        row.sourceSystem === "buildertrend"
          ? "Buildertrend history"
          : row.sourceSystem === "sage"
            ? "Sage / Square"
            : null,
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
    .where(
      and(
        eq(projectBudgetLines.projectId, projectId),
        eq(projectBudgetLines.applicationId, applicationId)
      )
    )
    .orderBy(
      asc(projectBudgetLines.csiDivision),
      asc(projectBudgetLines.sortOrder)
    )

  return {
    id: application.id,
    applicationNumber: application.applicationNumber,
    periodTo: application.periodTo,
    status: application.status,
    billedAt: application.billedAt,
    sageInvoiceNumber: application.sageInvoiceNumber,
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
      : (await readFeatureSettings(db, organizationId, "pay-applications")).ownerDetail,
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
  const changeOrders = await payApplicationChangeOrders(db, {
    projectId,
    applicationId,
    budgetRevisionId: draft.budgetRevisionId,
  })
  return { draft, project, changeOrders }
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
    const { db } = await verifyProjectUpdateAccess(projectId)
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
    const currentWorkCompleted = nonnegativeAmount(
      input.currentWorkCompleted,
      "Current work"
    )
    const storedMaterials = nonnegativeAmount(
      input.storedMaterials,
      "Stored materials"
    )
    const retainagePercent = nonnegativeAmount(
      input.retainagePercent,
      "Retainage"
    )
    if (retainagePercent > 100) {
      throw new Error("Retainage cannot exceed 100%.")
    }
    const totalCompletedStored =
      line.previousWorkCompleted + currentWorkCompleted + storedMaterials
    if (totalCompletedStored > line.adjustedEstimate + 0.01) {
      throw new Error(
        "Completed work and stored materials cannot exceed the adjusted budget line."
      )
    }
    const retainageHeld =
      Math.round(totalCompletedStored * retainagePercent) / 100
    const now = new Date().toISOString()
    await db
      .update(projectBudgetLines)
      .set({
        currentWorkCompleted,
        storedMaterials,
        priorCosts: line.previousWorkCompleted,
        currentCosts: currentWorkCompleted + storedMaterials,
        totalCosts: totalCompletedStored,
        percentComplete:
          line.adjustedEstimate > 0
            ? Math.round((totalCompletedStored / line.adjustedEstimate) * 1_000) /
              10
            : 0,
        balanceToFinish: line.adjustedEstimate - totalCompletedStored,
        retainageHeld,
        ownerVisible: input.ownerVisible,
        updatedAt: now,
      })
      .where(eq(projectBudgetLines.id, lineId))
      .run()
    await refreshOwnerPayApplication(db, projectId, applicationId, now)
    revalidateFinancialPaths(projectId)
    return { success: true, id: lineId }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Unable to update pay application.",
    }
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
      const totalCompletedStored =
        line.previousWorkCompleted + result.currentWorkCompleted + line.storedMaterials
      const retainageRate = line.totalCosts > 0 ? line.retainageHeld / line.totalCosts : 0
      return db
        .update(projectBudgetLines)
        .set({
          currentWorkCompleted: result.currentWorkCompleted,
          priorCosts: line.previousWorkCompleted,
          currentCosts: result.currentWorkCompleted + line.storedMaterials,
          totalCosts: totalCompletedStored,
          percentComplete:
            line.adjustedEstimate > 0
              ? Math.round((totalCompletedStored / line.adjustedEstimate) * 1_000) / 10
              : 0,
          balanceToFinish: line.adjustedEstimate - totalCompletedStored,
          retainageHeld: Math.round(totalCompletedStored * retainageRate * 100) / 100,
          updatedAt: now,
        })
        .where(eq(projectBudgetLines.id, line.id))
    })
    const [first, ...rest] = updates
    if (first) await db.batch([first, ...rest])
    await refreshOwnerPayApplication(db, projectId, applicationId, now)
    revalidateFinancialPaths(projectId)
    return { success: true, id: applicationId }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to bill by percent complete.",
    }
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
    await db
      .update(projectBudgetApplications)
      .set({ ownerDetail, updatedAt: new Date().toISOString() })
      .where(eq(projectBudgetApplications.id, applicationId))
      .run()
    revalidateFinancialPaths(projectId)
    return { success: true, id: applicationId }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to change the client detail.",
    }
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
    const { db } = await verifyProjectUpdateAccess(projectId)
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
    await syncDraftPayApplication(db, projectId, applicationId, targetRevisionId, new Date().toISOString())
    revalidateFinancialPaths(projectId)
    return { success: true, id: applicationId }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to update the pay application.",
    }
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
    await db.batch([
      db.delete(projectBudgetLines).where(eq(projectBudgetLines.applicationId, applicationId)),
      db
        .delete(projectOperations)
        .where(
          and(
            eq(projectOperations.projectId, projectId),
            eq(projectOperations.sourceRecordType, "owner_pay_application"),
            eq(projectOperations.sourceRecordId, applicationId)
          )
        ),
      db.delete(projectBudgetApplications).where(eq(projectBudgetApplications.id, applicationId)),
    ])
    // Its applied deposit is free again for the other drafts.
    await refreshAutoDepositPayApplications(db, projectId, new Date().toISOString())
    revalidateFinancialPaths(projectId)
    return { success: true, id: applicationId }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to delete the pay application.",
    }
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
    const { db } = await verifyProjectUpdateAccess(projectId)
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
    await db
      .update(projectBudgetApplications)
      .set({ depositAppliedMode: input.mode, depositApplied: amount, updatedAt: now })
      .where(eq(projectBudgetApplications.id, applicationId))
      .run()
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
    const rows = await db
      .select()
      .from(projectBudgetApplications)
      .where(
        and(
          eq(projectBudgetApplications.id, applicationId),
          eq(projectBudgetApplications.projectId, projectId),
          eq(projectBudgetApplications.status, "draft")
        )
      )
      .limit(1)
    const application = rows[0]
    if (!application) throw new Error("Draft pay application not found.")
    // A draw fully covered by the deposit still needs review and entry.
    if (application.currentPaymentDue <= 0 && application.depositApplied <= 0) {
      throw new Error("Enter current work or stored materials before Sage review.")
    }
    const lines = await db
      .select()
      .from(projectBudgetLines)
      .where(eq(projectBudgetLines.applicationId, applicationId))
      .orderBy(
        asc(projectBudgetLines.csiDivision),
        asc(projectBudgetLines.sortOrder)
      )
    if (lines.length === 0) {
      throw new Error("The pay application has no G703 lines.")
    }
    const now = new Date().toISOString()
    const sageReviewPayload = JSON.stringify({
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
    await db
      .update(projectBudgetApplications)
      .set({
        status: "internal_review",
        syncStatus: "needs_review",
        updatedAt: now,
      })
      .where(eq(projectBudgetApplications.id, applicationId))
      .run()
    await db
      .update(projectOperations)
      .set({
        status: "internal_review",
        sageWriteStatus: "draft_ready",
        sagePayloadJson: sageReviewPayload,
        syncStatus: "needs_review",
        updatedAt: now,
      })
      .where(
        and(
          eq(projectOperations.projectId, projectId),
          eq(projectOperations.sourceRecordId, applicationId)
        )
      )
      .run()
    revalidateFinancialPaths(projectId)
    return { success: true, id: applicationId }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Unable to stage Sage review.",
    }
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
    const now = new Date().toISOString()
    await db.batch([
      db
        .update(projectBudgetApplications)
        .set({ status: "draft", syncStatus: "compass_only", updatedAt: now })
        .where(eq(projectBudgetApplications.id, applicationId)),
      db
        .update(projectOperations)
        .set({ status: "draft", syncStatus: "compass_only", updatedAt: now })
        .where(
          and(
            eq(projectOperations.projectId, projectId),
            eq(projectOperations.sourceRecordType, "owner_pay_application"),
            eq(projectOperations.sourceRecordId, applicationId)
          )
        ),
    ])
    revalidateFinancialPaths(projectId)
    return { success: true, id: applicationId }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to return the pay application to draft.",
    }
  }
}

export async function getProjectFinancialCodingOptions(
  projectId: string
): Promise<ProjectFinancialCodingOptions> {
  const { db } = await verifyProjectReadAccess(projectId)
  const [sageRows, budgetRows] = await Promise.all([
    db
      .select({
        code: sageCostCodes.code,
        description: sageCostCodes.description,
        displayLabel: sageCostCodes.displayLabel,
        divisionCode: sageCostCodes.divisionCode,
        divisionDisplayLabel: sageCostCodes.divisionDisplayLabel,
      })
      .from(sageCostCodes)
      .where(eq(sageCostCodes.active, true))
      .orderBy(asc(sageCostCodes.divisionCode), asc(sageCostCodes.displayLabel)),
    db
      .select({
        costCode: projectBudgetLines.costCode,
        description: projectBudgetLines.description,
        divisionCode: projectBudgetLines.csiDivision,
        divisionName: projectBudgetLines.csiDivisionName,
      })
      .from(projectBudgetLines)
      .leftJoin(
        projectBudgetApplications,
        eq(projectBudgetApplications.id, projectBudgetLines.applicationId)
      )
      .where(
        and(
          eq(projectBudgetLines.projectId, projectId),
          or(
            isNull(projectBudgetApplications.status),
            ne(projectBudgetApplications.status, "building")
          )
        )
      )
      .orderBy(
        asc(projectBudgetLines.csiDivision),
        asc(projectBudgetLines.costCode)
      ),
  ])
  const phases = new Map<string, ProjectFinancialPhaseOption>()
  const costCodes = new Map<string, ProjectFinancialCostCodeOption>()

  for (const row of sageRows) {
    phases.set(row.divisionCode, {
      value: row.divisionCode,
      label: row.divisionDisplayLabel,
    })
    costCodes.set(row.code, {
      value: row.code,
      label: row.displayLabel,
      description: row.description,
      divisionCode: row.divisionCode,
    })
  }

  for (const row of budgetRows) {
    if (!phases.has(row.divisionCode)) {
      phases.set(row.divisionCode, {
        value: row.divisionCode,
        label: `${row.divisionCode} 00 00 ${row.divisionName}`,
      })
    }
    if (!costCodes.has(row.costCode)) {
      costCodes.set(row.costCode, {
        value: row.costCode,
        label: `${row.costCode} ${row.description}`,
        description: row.description,
        divisionCode: row.divisionCode,
      })
    }
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

    await db.insert(projectOperations).values({
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
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to stage vendor bill",
    }
  }
}

export async function createProjectRfqDraft(
  projectId: string,
  input: CreateProjectRfqInput
): Promise<ProjectFinancialWorkflowActionResult> {
  try {
    const { db, project } = await verifyProjectUpdateAccess(projectId)
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const title = requireText(input.title, "RFQ title")
    const recordNumber = await nextRecordNumber(db, projectId, "rfq")
    const requestedFrom = cleanText(input.requestedFrom)
    const vendorCategory = cleanText(input.vendorCategory)
    const responseDueDate = cleanText(input.responseDueDate)

    await db.insert(projectOperations).values({
      id,
      projectId,
      sourceSystem: "compass",
      sourceRecordType: "rfq",
      sourceRecordNumber: recordNumber,
      title,
      description: cleanText(input.scope),
      status: "draft",
      priority: cleanText(input.priority) ?? "normal",
      assigneeType: "vendor",
      assigneeName: requestedFrom,
      companyName: requestedFrom ?? vendorCategory,
      dueDate: responseDueDate,
      sageJobId: project.sageJobId,
      sageJobNumber: project.sageJobNumber,
      sageWriteStatus: "not_ready",
      sagePayloadJson: JSON.stringify({
        source: "compass_rfq",
        projectName: project.name,
        jobId: project.sageJobId,
        jobNumber: project.sageJobNumber,
        rfqNumber: recordNumber,
        title,
        vendorCategory,
        requestedFrom,
        responseDueDate,
        scope: cleanText(input.scope),
      }),
      syncDirection: "write",
      syncStatus: "compass_only",
      createdAt: now,
      updatedAt: now,
    })

    revalidateFinancialPaths(projectId)
    revalidatePath(`/dashboard/projects/${projectId}/rfis`)
    return { success: true, id }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create RFQ",
    }
  }
}

async function discardPartialPayApplication(
  db: ReturnType<typeof getDb>,
  applicationId: string
): Promise<void> {
  await db
    .delete(projectBudgetLines)
    .where(eq(projectBudgetLines.applicationId, applicationId))
  await db
    .delete(projectBudgetApplications)
    .where(eq(projectBudgetApplications.id, applicationId))
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
      await discardPartialPayApplication(db, duplicate.id)
    }
    const priorApplications = await db
      .select()
      .from(projectBudgetApplications)
      .where(
        and(
          eq(projectBudgetApplications.projectId, projectId),
          ne(projectBudgetApplications.status, "budget_current"),
          ne(projectBudgetApplications.status, "budget_superseded"),
          ne(projectBudgetApplications.status, "building")
        )
      )
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

    await db.insert(projectBudgetApplications).values({
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
      for (const rows of chunkD1Rows(applicationLineRows)) {
        await db.insert(projectBudgetLines).values(rows)
      }
    } catch (error) {
      await discardPartialPayApplication(db, applicationId)
      throw error
    }

    await db.insert(projectOperations).values({
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
    await db
      .update(projectBudgetApplications)
      .set({ status: "draft", updatedAt: now })
      .where(eq(projectBudgetApplications.id, applicationId))
      .run()

    revalidateFinancialPaths(projectId)
    return { success: true, id }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to create owner pay application",
    }
  }
}
