"use server"

import { and, asc, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import { projectOperations, projects } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { requireOrg } from "@/lib/org-scope"
import { requirePermission } from "@/lib/permissions"

export type ProjectFinancialWorkflowItem = {
  readonly id: string
  readonly type: "vendor_bill" | "owner_pay_application" | "rfq"
  readonly number: string | null
  readonly title: string
  readonly companyName: string | null
  readonly status: string
  readonly amount: number | null
  readonly dueDate: string | null
  readonly syncStatus: string
  readonly sageWriteStatus: string
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
  const rows = await db
    .select()
    .from(projectOperations)
    .where(
      and(
        eq(projectOperations.projectId, projectId),
        inArray(projectOperations.sourceRecordType, [
          "vendor_bill",
          "owner_pay_application",
          "rfq",
        ])
      )
    )
    .orderBy(asc(projectOperations.dueDate), asc(projectOperations.updatedAt))

  return rows.map((row) => ({
    id: row.id,
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
    updatedAt: row.updatedAt,
  }))
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
      syncStatus: "pending_sage",
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
    const recordNumber =
      cleanText(input.applicationNumber) ??
      (await nextRecordNumber(db, projectId, "owner_pay_application"))
    const periodTo = cleanText(input.periodTo)
    const amount = finiteAmount(input.amount)

    await db.insert(projectOperations).values({
      id,
      projectId,
      sourceSystem: "compass",
      sourceRecordType: "owner_pay_application",
      sourceRecordNumber: recordNumber,
      title: `${typeLabel("owner_pay_application")} ${recordNumber}`,
      description: cleanText(input.notes),
      status: "draft",
      priority: "normal",
      assigneeType: "owner",
      dueDate: periodTo,
      amount,
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
        amount,
        notes: cleanText(input.notes),
        format: "AIA_G702_G703_STYLE",
      }),
      syncDirection: "write",
      syncStatus: "pending_sage",
      createdAt: now,
      updatedAt: now,
    })

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
