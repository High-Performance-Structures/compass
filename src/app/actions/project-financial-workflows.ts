"use server"

import { and, asc, desc, eq, inArray, ne } from "drizzle-orm"
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
import { getCloudflareContext } from "@/lib/db"
import { requireOrg } from "@/lib/org-scope"
import { requirePermission } from "@/lib/permissions"

export type ProjectFinancialWorkflowItem = {
  readonly id: string
  readonly sourceRecordId: string | null
  readonly type: "vendor_bill" | "owner_pay_application" | "rfq"
  readonly number: string | null
  readonly title: string
  readonly companyName: string | null
  readonly status: string
  readonly amount: number | null
  readonly dueDate: string | null
  readonly syncStatus: string
  readonly sageWriteStatus: string
  readonly supportingPackageUrl: string | null
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
  readonly divisionCode: string
  readonly divisionName: string
  readonly description: string
  readonly originalEstimate: number
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
  readonly budgetRevisionId: string | null
  readonly originalContractSum: number
  readonly netChanges: number
  readonly contractSumToDate: number
  readonly totalCompletedStoredToDate: number
  readonly retainageHeld: number
  readonly totalEarnedLessRetainage: number
  readonly previousCertificates: number
  readonly currentPaymentDue: number
  readonly balanceToFinish: number
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
  return { db, project }
}

async function verifyProjectReadAccess(projectId: string): Promise<{
  readonly db: ReturnType<typeof getDb>
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
  return { db }
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
  return "RFQ"
}

function typeLabel(type: ProjectFinancialWorkflowItem["type"]): string {
  if (type === "vendor_bill") return "Vendor bill"
  if (type === "owner_pay_application") return "Owner pay application"
  return "Request for quote"
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
          inArray(projectOperations.sourceRecordType, [
            "vendor_bill",
            "owner_pay_application",
          ])
        )
      )
      .orderBy(asc(projectOperations.dueDate), asc(projectOperations.updatedAt)),
    db
      .select({
        applicationNumber: projectBudgetApplications.applicationNumber,
        sourceUrl: projectBudgetApplications.sourceUrl,
      })
      .from(projectBudgetApplications)
      .where(eq(projectBudgetApplications.projectId, projectId)),
  ])
  const applicationPackageUrls = new Map(
    applications.flatMap((application) => {
      const url = safeHttpUrl(application.sourceUrl)
      return url ? [[application.applicationNumber, url] as const] : []
    })
  )

  return rows.map((row) => ({
    id: row.id,
    sourceRecordId: row.sourceRecordId,
    type:
      row.sourceRecordType === "vendor_bill" ||
      row.sourceRecordType === "owner_pay_application"
        ? row.sourceRecordType
        : "rfq",
    number: row.sourceRecordNumber,
    title: row.title,
    companyName: row.companyName,
    status: row.status,
    amount: row.amount,
    dueDate: row.dueDate,
    syncStatus: row.syncStatus,
    sageWriteStatus: row.sageWriteStatus,
    supportingPackageUrl:
      safeHttpUrl(row.externalUrl) ??
      (row.sourceRecordType === "owner_pay_application" &&
      row.sourceRecordNumber
        ? applicationPackageUrls.get(row.sourceRecordNumber) ?? null
        : null),
    updatedAt: row.updatedAt,
  }))
}

export async function getProjectOwnerPayApplicationDraft(
  projectId: string,
  applicationId: string
): Promise<ProjectOwnerPayApplicationDraft | null> {
  const { db } = await verifyProjectReadAccess(projectId)
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
    budgetRevisionId: application.budgetRevisionId,
    originalContractSum: application.originalContractSum,
    netChanges: application.netChanges,
    contractSumToDate: application.contractSumToDate,
    totalCompletedStoredToDate: application.totalCompletedStoredToDate,
    retainageHeld: application.retainageHeld,
    totalEarnedLessRetainage: application.totalEarnedLessRetainage,
    previousCertificates: application.previousCertificates,
    currentPaymentDue: application.currentPaymentDue,
    balanceToFinish: application.balanceToFinish,
    lines: lines.map((line) => ({
      id: line.id,
      costCode: line.costCode,
      divisionCode: line.csiDivision,
      divisionName: line.csiDivisionName,
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
      ownerVisible: line.ownerVisible,
    })),
  }
}

function nonnegativeAmount(value: number | null, label: string): number {
  if (value === null || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be zero or greater.`)
  }
  return Math.round(value * 100) / 100
}

async function refreshOwnerPayApplication(
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
  const currentPaymentDue =
    Math.round(
      (totalEarnedLessRetainage - application.previousCertificates) * 100
    ) / 100
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
    if (application.currentPaymentDue <= 0) {
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
        currentPaymentDue: application.currentPaymentDue,
        balanceToFinish: application.balanceToFinish,
      },
      g703: lines.map((line) => ({
        sourceLineId: line.id,
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
      .where(eq(projectBudgetLines.projectId, projectId))
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
      .select({ id: projectBudgetApplications.id })
      .from(projectBudgetApplications)
      .where(
        and(
          eq(projectBudgetApplications.projectId, projectId),
          eq(projectBudgetApplications.applicationNumber, recordNumber)
        )
      )
      .limit(1)
    if (duplicateRows[0]) {
      throw new Error("That pay application number already exists.")
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
    const priorByCostCode = new Map(
      priorLines.map((line) => [
        line.costCode,
        {
          totalCompletedStored: line.totalCosts,
          retainageHeld: line.retainageHeld,
        },
      ])
    )
    const originalContractSum = revision.originalContractSumCents / 100
    const netChanges = revision.approvedChangesCents / 100
    const contractSumToDate = revision.revisedContractSumCents / 100
    const previousCertificates =
      priorApplication?.totalEarnedLessRetainage ?? 0
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

    await db.insert(projectBudgetLines).values(
      revisionLines.map((line) => {
        const originalEstimate = line.originalEstimateCents / 100
        const totalChanges = line.approvedChangeCents / 100
        const adjustedEstimate = line.adjustedBudgetCents / 100
        const prior = priorByCostCode.get(line.costCode)
        const priorCosts = prior?.totalCompletedStored ?? 0
        return {
          id: crypto.randomUUID(),
          projectId,
          applicationId,
          budgetRevisionLineId: line.id,
          sourceSystem: "compass_contract_budget",
          sourceRecordId: line.id,
          sourceRecordNumber: line.costCode,
          costCode: line.costCode,
          csiDivision: line.divisionCode,
          csiDivisionName: line.divisionName,
          description: line.description,
          notes: null,
          originalEstimate,
          priorChanges: totalChanges,
          currentChanges: 0,
          totalChanges,
          adjustedEstimate,
          previousWorkCompleted: priorCosts,
          currentWorkCompleted: 0,
          storedMaterials: 0,
          priorCosts,
          currentCosts: 0,
          totalCosts: priorCosts,
          percentComplete:
            adjustedEstimate > 0
              ? Math.round((priorCosts / adjustedEstimate) * 1_000) / 10
              : 0,
          balanceToFinish: adjustedEstimate - priorCosts,
          retainageHeld: prior?.retainageHeld ?? 0,
          vendorName: null,
          ownerLabel: line.description,
          ownerVisible: line.ownerVisible,
          internalNotes: `Contract budget revision ${revision.revisionNumber}.`,
          sortOrder: line.sortOrder,
          syncStatus: "compass_only",
          lastSyncedAt: null,
          createdAt: now,
          updatedAt: now,
        }
      })
    )

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
