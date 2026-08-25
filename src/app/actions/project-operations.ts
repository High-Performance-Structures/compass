"use server"

import { and, asc, eq, gte, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  projectBudgetApplications,
  projectBudgetLines,
  projectContacts,
  projectOperations,
  projectPurchaseOrderLines,
  projects,
  sageCostCodes,
  scheduleTasks,
  vendors,
} from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { findTemplatePlaceholders } from "@/lib/templates/template-bid-package"
import { notifyProjectAssignment } from "@/lib/notifications/events"
import {
  PROJECT_TODO_RECORD_TYPES,
  type ProjectTodoStatus,
  isArchivedProjectTodoStatus,
  isCompletedProjectTodoStatus,
  isProjectTodoRecordType,
  isProjectTodoStatus,
} from "@/lib/project-todos"
import {
  isPurchaseOrderStatus,
  isRfqStatus,
  purchaseOrderStatusAfterEmail,
} from "@/lib/project-operations/status"
import { canEditPurchaseOrderDraft } from "@/lib/purchase-orders/draft-edit"
import { linkedScheduleTaskId } from "@/lib/schedule/linked-todos"
import {
  normalizePurchaseOrderLines,
  type NormalizedPurchaseOrderLine,
} from "@/lib/purchase-orders/line-items"
import {
  purchaseOrderEmailHtml,
  purchaseOrderEmailText,
} from "@/lib/purchase-orders/email"
import { projectBrandFor } from "@/lib/project-branding"
import {
  parsePortalPurchaseOrderPayload,
  type PortalPurchaseOrderAcknowledgement,
  withPortalPurchaseOrderRecipients,
} from "@/lib/purchase-orders/portal-response"
import { resolvedPurchaseOrderShipTo } from "@/lib/purchase-orders/ship-to"
import { purchaseOrderVendorDetails } from "@/lib/purchase-orders/vendor-details"
import {
  parsePortalRfqPayload,
  type PortalRfqVendorResponse,
} from "@/lib/rfqs/portal-response"

export type ProjectOperationKind = "purchase_order" | "rfq"

export type ProjectOperationItem = {
  readonly id: string
  readonly sourceSystem: string
  readonly sourceRecordType: string
  readonly sourceRecordId: string | null
  readonly linkedScheduleTaskId: string | null
  readonly sourceRecordNumber: string | null
  readonly title: string
  readonly description: string | null
  readonly status: string
  readonly priority: string
  readonly assigneeType: string | null
  readonly assigneeName: string | null
  readonly siteContactPhone: string | null
  readonly companyName: string | null
  readonly costCode: string | null
  readonly startDate: string | null
  readonly dueDate: string | null
  readonly amount: number | null
  readonly externalUrl: string | null
  readonly syncStatus: string
  readonly sageJobId: string | null
  readonly sageJobNumber: string | null
  readonly sageVendorId: string | null
  readonly sageVendorName: string | null
  readonly sagePhaseCode: string | null
  readonly sageCostCode: string | null
  readonly sageTaxGroup: string | null
  readonly sageShipTo: string | null
  readonly sageOrderDate: string | null
  readonly sageRequiredDate: string | null
  readonly sageWriteStatus: string
  readonly sagePayloadJson: string | null
  readonly updatedAt: string
}

export type ProjectPurchaseOrderLineItem = {
  readonly id: string
  readonly operationId: string
  readonly lineNumber: number
  readonly costCode: string | null
  readonly phaseCode: string | null
  readonly description: string
  readonly quantity: number
  readonly unitCost: number
  readonly unit: string | null
  readonly amount: number
  readonly taxGroup: string | null
  readonly syncStatus: string
}

export type ProjectPurchaseOrderItem = ProjectOperationItem & {
  readonly lines: readonly ProjectPurchaseOrderLineItem[]
  readonly vendorAddress: string | null
  readonly vendorEmail: string | null
  readonly vendorAcknowledgement: PortalPurchaseOrderAcknowledgement | null
}

export type ProjectPurchaseOrderPhaseOption = {
  readonly value: string
  readonly label: string
}

export type ProjectPurchaseOrderCostCodeOption = {
  readonly value: string
  readonly label: string
  readonly description: string
  readonly divisionCode: string
}

export type ProjectPurchaseOrderFormOptions = {
  readonly jobsiteAddress: string | null
  readonly phases: readonly ProjectPurchaseOrderPhaseOption[]
  readonly costCodes: readonly ProjectPurchaseOrderCostCodeOption[]
}

export type ProjectRfqScopeLineItem = {
  readonly lineNumber: number
  readonly description: string
  readonly phaseCode: string | null
  readonly costCode: string | null
  readonly notes: string | null
}

export type ProjectRfqDocumentLinkItem = {
  readonly lineNumber: number
  readonly label: string
  readonly url: string
  readonly notes: string | null
}

export type ProjectRfqItem = ProjectOperationItem & {
  readonly vendorCategory: string | null
  readonly recipientEmail: string | null
  readonly scopeItems: readonly ProjectRfqScopeLineItem[]
  readonly documentLinks: readonly ProjectRfqDocumentLinkItem[]
  readonly templateReview: {
    readonly unresolvedPlaceholders: readonly string[]
    readonly requiresDocumentPackage: boolean
  } | null
  readonly vendorResponse: PortalRfqVendorResponse | null
}

export type NextScheduleItem = {
  readonly id: string
  readonly title: string
  readonly startDate: string
  readonly endDate: string
  readonly assignedTo: string | null
  readonly source: "compass_schedule" | "sage_operation"
}

export type ProjectOperationsSummary = {
  readonly openPurchaseOrderCount: number
  readonly openPurchaseOrderTotal: number
  readonly activeCommitmentCount: number
  readonly nextScheduleItem: NextScheduleItem | null
  readonly purchaseOrders: readonly ProjectOperationItem[]
  readonly commitments: readonly ProjectOperationItem[]
}

export type ProjectSageSyncItemKind =
  | "project_handoff"
  | "purchase_order"
  | "task"
  | "vendor_bill"
  | "owner_pay_application"
  | "rfq"
  | "budget_application"
  | "budget_line"
  | "google_handoff"

export type ProjectSageSyncItem = {
  readonly id: string
  readonly kind: ProjectSageSyncItemKind
  readonly table: "project_operations" | "project_budget_applications" | "project_budget_lines"
  readonly title: string
  readonly recordNumber: string | null
  readonly status: string
  readonly syncStatus: string
  readonly sageWriteStatus: string | null
  readonly syncDirection: string | null
  readonly amount: number | null
  readonly dueDate: string | null
  readonly updatedAt: string
  readonly detail: string | null
}

export type ProjectSageSyncQueue = {
  readonly pendingItems: readonly ProjectSageSyncItem[]
  readonly readyCount: number
  readonly queuedCount: number
  readonly blockedCount: number
}

type ProjectOperationActionResult =
  | { readonly success: true; readonly id: string }
  | { readonly success: false; readonly error: string }

type ProjectOperationEmailActionResult =
  | {
      readonly success: true
      readonly status: string
      readonly providerMessageId: string | null
    }
  | { readonly success: false; readonly error: string }

type ProjectSyncActionResult =
  | { readonly success: true; readonly updatedCount: number }
  | { readonly success: false; readonly error: string }

export type CreatePurchaseOrderRequestInput = {
  readonly title: string
  readonly description: string | null
  readonly companyName: string | null
  readonly sageVendorId: string | null
  readonly assigneeName: string | null
  readonly siteContactPhone: string | null
  readonly shipTo: string | null
  readonly orderDate: string | null
  readonly dueDate: string | null
  readonly priority: string
  readonly lines: readonly CreatePurchaseOrderLineInput[]
}

export type UpdatePurchaseOrderRequestInput =
  CreatePurchaseOrderRequestInput & {
    readonly expectedUpdatedAt: string
  }

export type CreatePurchaseOrderLineInput = {
  readonly description: string | null
  readonly costCode: string | null
  readonly phaseCode: string | null
  readonly quantity: number | null
  readonly unitCost: number | null
  readonly unit: string | null
  readonly amount: number | null
  readonly taxGroup: string | null
}

export type CreateRfqScopeLineInput = {
  readonly description: string | null
  readonly costCode: string | null
  readonly phaseCode: string | null
  readonly notes: string | null
}

export type CreateRfqDocumentLinkInput = {
  readonly label: string | null
  readonly url: string | null
  readonly notes: string | null
}

export type CreateRfqRequestInput = {
  readonly title: string
  readonly vendorCategory: string | null
  readonly requestedFrom: string | null
  readonly recipientEmail: string | null
  readonly responseDueDate: string | null
  readonly priority: string
  readonly scope: string | null
  readonly scopeItems: readonly CreateRfqScopeLineInput[]
  readonly documentLinks: readonly CreateRfqDocumentLinkInput[]
}

export type UpdateRfqRequestInput = CreateRfqRequestInput

export type SendPurchaseOrderEmailInput = {
  readonly to: string
  readonly cc: string | null
  readonly subject: string
  readonly message: string
}

export type ProjectTaskRecordType =
  | "staff_task"
  | "subcontractor_task"
  | "supplier_task"
  | "schedule_task"

export type CreateProjectTaskInput = {
  readonly title: string
  readonly description: string | null
  readonly sourceRecordType: ProjectTaskRecordType
  readonly sourceRecordId: string | null
  readonly sourceRecordNumber: string | null
  readonly assigneeName: string | null
  readonly companyName: string | null
  readonly startDate: string | null
  readonly dueDate: string | null
  readonly priority: string
  readonly externalUrl: string | null
}

export type UpdateProjectTodoInput = {
  readonly title: string
  readonly description: string | null
  readonly sourceRecordType: ProjectTaskRecordType
  readonly status: ProjectTodoStatus
  readonly priority: string
  readonly assigneeName: string | null
  readonly companyName: string | null
  readonly startDate: string | null
  readonly dueDate: string | null
  readonly expectedUpdatedAt: string
}

export type ProjectTodoActionResult =
  | {
      readonly success: true
      readonly id: string
      readonly updatedAt: string
    }
  | { readonly success: false; readonly error: string }

type SagePurchaseOrderPayload = {
  readonly source: "compass_po_request"
  readonly header: {
    readonly jobId: string | null
    readonly jobNumber: string | null
    readonly vendorId: string | null
    readonly vendorName: string | null
    readonly poNumber: string | null
    readonly description: string
    readonly orderDate: string | null
    readonly requiredDate: string | null
    readonly shipTo: string | null
    readonly status: string
  }
  readonly lines: readonly {
    readonly lineNumber: number
    readonly phaseCode: string | null
    readonly costCode: string | null
    readonly description: string
    readonly quantity: number
    readonly unitCost: number
    readonly unit: string | null
    readonly amount: number
    readonly taxGroup: string | null
  }[]
}

type NormalizedRfqScopeLine = {
  readonly lineNumber: number
  readonly description: string
  readonly costCode: string | null
  readonly phaseCode: string | null
  readonly notes: string | null
}

type NormalizedRfqDocumentLink = {
  readonly lineNumber: number
  readonly label: string
  readonly url: string
  readonly notes: string | null
}

async function verifyProjectAccess(
  projectId: string,
  featureId: string = "project-hub"
): Promise<ReturnType<typeof getDb>> {
  const user = await requireAuth()
  await requireFeaturePermission(user, featureId, "read")
  const orgId = requireOrg(user)

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  const existing = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
    .limit(1)

  if (!existing[0]) {
    throw new Error("Project not found")
  }

  return db
}

async function verifyProjectUpdateAccess(
  projectId: string,
  featureId: string = "project-hub"
): Promise<ReturnType<typeof getDb>> {
  const user = await requireAuth()
  if (isDemoUser(user.id)) {
    throw new Error("DEMO_READ_ONLY")
  }
  await requireFeaturePermission(user, featureId, "update")
  const orgId = requireOrg(user)

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  const existing = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
    .limit(1)

  if (!existing[0]) {
    throw new Error("Project not found")
  }

  return db
}

function cleanText(value: string | null): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed.length > 0 ? trimmed : null
}

function cleanDate(value: string | null, label: string): string | null {
  const cleaned = cleanText(value)
  if (cleaned === null) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    throw new Error(`${label} must be a valid date`)
  }

  const parsed = new Date(`${cleaned}T12:00:00Z`)
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== cleaned
  ) {
    throw new Error(`${label} must be a valid date`)
  }
  return cleaned
}

function requireText(value: string, label: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new Error(`${label} is required`)
  }
  return trimmed
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function envString(env: unknown, key: string): string | null {
  if (!isRecord(env)) return process.env[key] ?? null
  const value = env[key]
  return typeof value === "string" && value.trim().length > 0
    ? value
    : process.env[key] ?? null
}

function parseEmailList(value: string | null): readonly string[] {
  const trimmed = value?.trim() ?? ""
  if (trimmed.length === 0) return []
  return trimmed
    .split(/[,\s;]+/)
    .map((email) => email.trim().toLowerCase())
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
}

function purchaseOrderRequestNumberFor(
  projectNumber: string | null,
  existingCount: number,
  id: string
): string {
  const sequence = String(existingCount + 1).padStart(3, "0")
  const prefix = cleanText(projectNumber)
  if (prefix) return `${prefix}-PO-${sequence}`

  const collisionSuffix = id.slice(0, 6).toUpperCase()
  return `PO-REQ-${sequence}-${collisionSuffix}`
}

function projectDocumentNumberFor(
  projectNumber: string | null,
  documentType: string,
  existingCount: number
): string {
  const sequence = String(existingCount + 1).padStart(3, "0")
  const prefix = cleanText(projectNumber)
  return prefix
    ? `${prefix}-${documentType}-${sequence}`
    : `${documentType}-${sequence}`
}

function sageShortProjectDocumentNumberFor(
  projectNumber: string | null,
  documentType: string,
  existingCount: number
): string {
  const sequence = String(existingCount + 1).padStart(3, "0")
  const prefix = cleanText(projectNumber)
  if (!prefix) return `${documentType}-${sequence}`

  const [department, series] = prefix.split("-")
  if (department && series) {
    return `${department}-${series}-${documentType}-${sequence}`
  }

  return `${prefix}-${documentType}-${sequence}`
}

function projectTaskNumberFor(existingCount: number): string {
  return `TASK-${String(existingCount + 1).padStart(3, "0")}`
}

function normalizeTaskRecordType(value: ProjectTaskRecordType): ProjectTaskRecordType {
  if (value === "subcontractor_task") return "subcontractor_task"
  if (value === "supplier_task") return "supplier_task"
  if (value === "schedule_task") return "schedule_task"
  return "staff_task"
}

function assigneeTypeForTask(recordType: ProjectTaskRecordType): string {
  if (recordType === "subcontractor_task") return "subcontractor"
  if (recordType === "supplier_task") return "supplier"
  return "internal"
}

function revalidateProjectTodoPaths(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}`)
  revalidatePath(`/dashboard/projects/${projectId}/todos`)
  revalidatePath(`/dashboard/projects/${projectId}/daily-logs`)
  revalidatePath(`/dashboard/projects/${projectId}/schedule`)
  revalidatePath("/dashboard")
  revalidatePath("/dashboard/schedule")
}

function operationSyncKind(recordType: string): ProjectSageSyncItemKind {
  if (recordType === "sage_project_handoff") return "project_handoff"
  if (recordType === "google_project_intake") return "project_handoff"
  if (recordType === "purchase_order") return "purchase_order"
  if (recordType === "google_nutech_order") return "purchase_order"
  if (recordType === "vendor_bill") return "vendor_bill"
  if (recordType === "owner_pay_application") return "owner_pay_application"
  if (recordType === "rfq") return "rfq"
  if (
    recordType === "google_finish_schedule" ||
    recordType === "google_script_handoff"
  ) {
    return "google_handoff"
  }
  return "task"
}

function operationCanQueueForSage(
  operation: typeof projectOperations.$inferSelect
): boolean {
  if (operation.syncDirection !== "write") return false
  if (["queued_sage", "syncing", "synced"].includes(operation.syncStatus)) {
    return false
  }
  if (operation.sageWriteStatus === "not_ready") return false
  return ["pending_sage", "needs_review", "failed", "compass_only"].includes(
    operation.syncStatus
  )
}

function syncQueueStatus(item: {
  readonly syncStatus: string
  readonly sageWriteStatus: string | null
  readonly syncDirection: string | null
}): "ready" | "queued" | "blocked" {
  if (item.syncStatus === "queued_sage" || item.syncStatus === "syncing") {
    return "queued"
  }
  if (item.syncDirection !== "write") return "blocked"
  if (item.sageWriteStatus === "not_ready") return "blocked"
  return "ready"
}

function normalizeRfqScopeLines(
  lines: readonly CreateRfqScopeLineInput[],
  fallbackDescription: string
): readonly NormalizedRfqScopeLine[] {
  const normalized = lines
    .map((line, index) => {
      const description = cleanText(line.description)
      const costCode = cleanText(line.costCode)
      const phaseCode = cleanText(line.phaseCode)
      const notes = cleanText(line.notes)
      const hasMeaningfulValue =
        description !== null ||
        costCode !== null ||
        phaseCode !== null ||
        notes !== null

      if (!hasMeaningfulValue) return null

      return {
        lineNumber: index + 1,
        description: description ?? fallbackDescription,
        costCode,
        phaseCode,
        notes,
      }
    })
    .filter((line) => line !== null)

  if (normalized.length > 0) return normalized

  return [
    {
      lineNumber: 1,
      description: fallbackDescription,
      costCode: null,
      phaseCode: null,
      notes: null,
    },
  ]
}

function normalizeRfqDocumentLinks(
  links: readonly CreateRfqDocumentLinkInput[]
): readonly NormalizedRfqDocumentLink[] {
  return links
    .map((link, index) => {
      const label = cleanText(link.label)
      const url = cleanText(link.url)
      const notes = cleanText(link.notes)

      if (label === null && url === null && notes === null) return null
      if (url === null) {
        throw new Error("Each RFQ document link needs a URL.")
      }

      return {
        lineNumber: index + 1,
        label: label ?? `Document ${index + 1}`,
        url,
        notes,
      }
    })
    .filter((link) => link !== null)
}

function buildSagePurchaseOrderPayload(input: {
  readonly project: {
    readonly sageJobId: string | null
    readonly sageJobNumber: string | null
  }
  readonly sourceRecordNumber: string
  readonly title: string
  readonly description: string | null
  readonly companyName: string | null
  readonly sageVendorId: string | null
  readonly shipTo: string | null
  readonly orderDate: string | null
  readonly dueDate: string | null
  readonly lines: readonly NormalizedPurchaseOrderLine[]
}): SagePurchaseOrderPayload {
  return {
    source: "compass_po_request",
    header: {
      jobId: input.project.sageJobId,
      jobNumber: input.project.sageJobNumber,
      vendorId: input.sageVendorId,
      vendorName: input.companyName,
      poNumber: input.sourceRecordNumber,
      description: input.title,
      orderDate: input.orderDate,
      requiredDate: input.dueDate,
      shipTo: input.shipTo,
      status: "draft",
    },
    lines: input.lines.map((line) => ({
      lineNumber: line.lineNumber,
      phaseCode: line.phaseCode,
      costCode: line.costCode,
      description: line.description,
      quantity: line.quantity,
      unitCost: line.unitCost,
      unit: line.unit,
      amount: line.amount,
      taxGroup: line.taxGroup,
    })),
  }
}

function stringValue(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === "string" ? value : null
}

function numberValue(record: Record<string, unknown>, key: string): number | null {
  const value = record[key]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function parseJsonRecord(value: string | null): Record<string, unknown> | null {
  if (!value) return null

  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function parseRfqScopeItems(
  payload: Record<string, unknown> | null,
  fallbackDescription: string | null
): readonly ProjectRfqScopeLineItem[] {
  const rawLines = payload?.scopeItems
  if (!Array.isArray(rawLines)) {
    return fallbackDescription
      ? [
          {
            lineNumber: 1,
            description: fallbackDescription,
            phaseCode: null,
            costCode: null,
            notes: null,
          },
        ]
      : []
  }

  return rawLines
    .map((line, index) => {
      if (!isRecord(line)) return null

      const description = stringValue(line, "description") ?? fallbackDescription
      if (!description) return null

      return {
        lineNumber: numberValue(line, "lineNumber") ?? index + 1,
        description,
        phaseCode: stringValue(line, "phaseCode"),
        costCode: stringValue(line, "costCode"),
        notes: stringValue(line, "notes"),
      }
    })
    .filter((line) => line !== null)
}

function parseRfqDocumentLinks(
  payload: Record<string, unknown> | null
): readonly ProjectRfqDocumentLinkItem[] {
  const rawLinks = payload?.documentLinks
  if (!Array.isArray(rawLinks)) return []

  return rawLinks
    .map((link, index) => {
      if (!isRecord(link)) return null

      const url = stringValue(link, "url")
      if (url === null) return null

      return {
        lineNumber: numberValue(link, "lineNumber") ?? index + 1,
        label: stringValue(link, "label") ?? `Document ${index + 1}`,
        url,
        notes: stringValue(link, "notes"),
      }
    })
    .filter((link) => link !== null)
}

function parseRfqTemplateReview(
  payload: Record<string, unknown> | null
): ProjectRfqItem["templateReview"] {
  const value = payload?.templateReview
  if (!isRecord(value)) return null
  const rawPlaceholders = value.unresolvedPlaceholders
  const unresolvedPlaceholders = Array.isArray(rawPlaceholders)
    ? rawPlaceholders.filter(
        (placeholder): placeholder is string => typeof placeholder === "string"
      )
    : []
  const requiresDocumentPackage = value.requiresDocumentPackage === true
  return unresolvedPlaceholders.length > 0 || requiresDocumentPackage
    ? { unresolvedPlaceholders, requiresDocumentPackage }
    : null
}

function toOperationItem(
  row: typeof projectOperations.$inferSelect,
  scheduleTaskIds: ReadonlySet<string> = new Set()
): ProjectOperationItem {
  return {
    id: row.id,
    sourceSystem: row.sourceSystem,
    sourceRecordType: row.sourceRecordType,
    sourceRecordId: row.sourceRecordId,
    linkedScheduleTaskId: linkedScheduleTaskId(row, scheduleTaskIds),
    sourceRecordNumber: row.sourceRecordNumber,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    assigneeType: row.assigneeType,
    assigneeName: row.assigneeName,
    siteContactPhone: row.siteContactPhone,
    companyName: row.companyName,
    costCode: row.costCode,
    startDate: row.startDate,
    dueDate: row.dueDate,
    amount: row.amount,
    externalUrl: row.externalUrl,
    syncStatus: row.syncStatus,
    sageJobId: row.sageJobId,
    sageJobNumber: row.sageJobNumber,
    sageVendorId: row.sageVendorId,
    sageVendorName: row.sageVendorName,
    sagePhaseCode: row.sagePhaseCode,
    sageCostCode: row.sageCostCode,
    sageTaxGroup: row.sageTaxGroup,
    sageShipTo: row.sageShipTo,
    sageOrderDate: row.sageOrderDate,
    sageRequiredDate: row.sageRequiredDate,
    sageWriteStatus: row.sageWriteStatus,
    sagePayloadJson: row.sagePayloadJson,
    updatedAt: row.updatedAt,
  }
}

function toRfqItem(
  row: typeof projectOperations.$inferSelect,
  recipientEmail: string | null
): ProjectRfqItem {
  const payload = parseJsonRecord(row.sagePayloadJson)
  const portalPayload = parsePortalRfqPayload(row.sagePayloadJson)

  return {
    ...toOperationItem(row),
    vendorCategory: stringValue(payload ?? {}, "vendorCategory"),
    recipientEmail:
      stringValue(payload ?? {}, "recipientEmail") ?? recipientEmail,
    scopeItems: parseRfqScopeItems(payload, row.description),
    documentLinks: parseRfqDocumentLinks(payload),
    templateReview: parseRfqTemplateReview(payload),
    vendorResponse: portalPayload.vendorResponse,
  }
}

function toPurchaseOrderLineItem(
  row: typeof projectPurchaseOrderLines.$inferSelect
): ProjectPurchaseOrderLineItem {
  return {
    id: row.id,
    operationId: row.operationId,
    lineNumber: row.lineNumber,
    costCode: row.costCode,
    phaseCode: row.phaseCode,
    description: row.description,
    quantity: row.quantity,
    unitCost: row.unitCost,
    unit: row.unit,
    amount: row.amount,
    taxGroup: row.taxGroup,
    syncStatus: row.syncStatus,
  }
}

async function sendResendPurchaseOrderEmail(
  env: unknown,
  input: {
    readonly to: readonly string[]
    readonly cc: readonly string[]
    readonly subject: string
    readonly text: string
    readonly html: string
  }
): Promise<{
  readonly status: string
  readonly providerMessageId: string | null
  readonly error: string | null
}> {
  const apiKey = envString(env, "RESEND_API_KEY")
  if (!apiKey) {
    return {
      status: "pending_provider",
      providerMessageId: null,
      error: "RESEND_API_KEY is not configured",
    }
  }

  const fromAddress =
    envString(env, "COMPASS_EMAIL_FROM") ??
    "Compass <notifications@compass.build>"
  const requestBody: Record<string, unknown> = {
    from: fromAddress,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  }
  if (input.cc.length > 0) {
    requestBody.cc = input.cc
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  })

  const responseText = await response.text()
  let providerMessageId: string | null = null
  try {
    const parsed = JSON.parse(responseText)
    if (isRecord(parsed) && typeof parsed.id === "string") {
      providerMessageId = parsed.id
    }
  } catch {
    providerMessageId = null
  }

  return {
    status: response.ok ? "sent" : "failed",
    providerMessageId,
    error: response.ok ? null : responseText.slice(0, 500),
  }
}

function operationToScheduleItem(
  operation: typeof projectOperations.$inferSelect
): NextScheduleItem {
  return {
    id: operation.id,
    title: operation.title,
    startDate: operation.startDate ?? operation.dueDate ?? "",
    endDate: operation.dueDate ?? operation.startDate ?? "",
    assignedTo: operation.assigneeName ?? operation.companyName,
    source: "sage_operation",
  }
}

export async function getProjectOperationsSummary(
  projectId: string
): Promise<ProjectOperationsSummary> {
  const db = await verifyProjectAccess(projectId)
  const today = new Date().toISOString().slice(0, 10)

  const operations = await db
    .select()
    .from(projectOperations)
    .where(eq(projectOperations.projectId, projectId))
    .orderBy(asc(projectOperations.dueDate), asc(projectOperations.title))

  const purchaseOrders = operations.filter(
    (operation) => operation.sourceRecordType === "purchase_order"
  )
  const commitments = operations.filter((operation) =>
    isProjectTodoRecordType(operation.sourceRecordType)
  )

  const openPurchaseOrders = purchaseOrders.filter(
    (operation) => !["closed", "void", "complete"].includes(operation.status)
  )
  const activeCommitments = commitments.filter(
    (operation) =>
      !isCompletedProjectTodoStatus(operation.status) &&
      !isArchivedProjectTodoStatus(operation.status)
  )

  const [nextCompassTask] = await db
    .select()
    .from(scheduleTasks)
    .where(
      and(
        eq(scheduleTasks.projectId, projectId),
        gte(scheduleTasks.endDateCalculated, today),
        inArray(scheduleTasks.status, ["PENDING", "IN_PROGRESS"])
      )
    )
    .orderBy(asc(scheduleTasks.startDate), asc(scheduleTasks.sortOrder))
    .limit(1)

  const nextSageOperation = activeCommitments.find(
    (operation) =>
      (operation.startDate !== null && operation.startDate >= today) ||
      (operation.dueDate !== null && operation.dueDate >= today)
  )

  const nextScheduleItem = nextCompassTask
    ? {
        id: nextCompassTask.id,
        title: nextCompassTask.title,
        startDate: nextCompassTask.startDate,
        endDate: nextCompassTask.endDateCalculated,
        assignedTo: nextCompassTask.assignedTo,
        source: "compass_schedule" as const,
      }
    : nextSageOperation
      ? operationToScheduleItem(nextSageOperation)
      : null

  return {
    openPurchaseOrderCount: openPurchaseOrders.length,
    openPurchaseOrderTotal: openPurchaseOrders.reduce(
      (total, operation) => total + (operation.amount ?? 0),
      0
    ),
    activeCommitmentCount: activeCommitments.length,
    nextScheduleItem,
    purchaseOrders: purchaseOrders
      .slice(0, 5)
      .map((operation) => toOperationItem(operation)),
    commitments: commitments
      .slice(0, 6)
      .map((operation) => toOperationItem(operation)),
  }
}

export async function getProjectTodos(
  projectId: string
): Promise<readonly ProjectOperationItem[]> {
  const user = await requireAuth()
  let db: ReturnType<typeof getDb>
  try {
    db = await verifyProjectAccess(projectId, "tasks")
  } catch (error) {
    if (
      isDemoUser(user.id) &&
      error instanceof Error &&
      error.message === "Project not found"
    ) {
      return []
    }
    throw error
  }

  const operations = await db
    .select()
    .from(projectOperations)
    .where(
      and(
        eq(projectOperations.projectId, projectId),
        inArray(projectOperations.sourceRecordType, [
          ...PROJECT_TODO_RECORD_TYPES,
        ])
      )
    )
    .orderBy(
      asc(projectOperations.dueDate),
      asc(projectOperations.createdAt),
      asc(projectOperations.title)
    )

  const candidateScheduleTaskIds = [
    ...new Set(
      operations.flatMap((operation) =>
        operation.sourceRecordId ? [operation.sourceRecordId] : []
      )
    ),
  ]
  const scheduleTaskIds = new Set(
    candidateScheduleTaskIds.length === 0
      ? []
      : (
          await db
            .select({ id: scheduleTasks.id })
            .from(scheduleTasks)
            .where(
              and(
                eq(scheduleTasks.projectId, projectId),
                inArray(scheduleTasks.id, candidateScheduleTaskIds)
              )
            )
        ).map((task) => task.id)
  )

  return operations.map((operation) =>
    toOperationItem(operation, scheduleTaskIds)
  )
}

export async function getScheduleTaskTodos(
  projectId: string,
  scheduleTaskId: string
): Promise<readonly ProjectOperationItem[]> {
  const db = await verifyProjectAccess(projectId, "tasks")
  const [scheduleTask] = await db
    .select({ id: scheduleTasks.id })
    .from(scheduleTasks)
    .where(
      and(
        eq(scheduleTasks.id, scheduleTaskId),
        eq(scheduleTasks.projectId, projectId)
      )
    )
    .limit(1)

  if (!scheduleTask) return []

  const operations = await db
    .select()
    .from(projectOperations)
    .where(
      and(
        eq(projectOperations.projectId, projectId),
        eq(projectOperations.sourceRecordId, scheduleTask.id),
        inArray(projectOperations.sourceRecordType, [
          ...PROJECT_TODO_RECORD_TYPES,
        ])
      )
    )
    .orderBy(
      asc(projectOperations.dueDate),
      asc(projectOperations.createdAt),
      asc(projectOperations.title)
    )

  const scheduleTaskIds = new Set([scheduleTask.id])
  return operations.map((operation) =>
    toOperationItem(operation, scheduleTaskIds)
  )
}

export async function getProjectSageSyncQueue(
  projectId: string
): Promise<ProjectSageSyncQueue> {
  const db = await verifyProjectAccess(projectId, "sage-sync")

  const operationRows = await db
    .select()
    .from(projectOperations)
    .where(eq(projectOperations.projectId, projectId))
    .orderBy(asc(projectOperations.updatedAt), asc(projectOperations.title))

  const applicationRows = await db
    .select()
    .from(projectBudgetApplications)
    .where(eq(projectBudgetApplications.projectId, projectId))
    .orderBy(asc(projectBudgetApplications.updatedAt))

  const budgetLineRows = await db
    .select()
    .from(projectBudgetLines)
    .where(eq(projectBudgetLines.projectId, projectId))
    .orderBy(asc(projectBudgetLines.updatedAt), asc(projectBudgetLines.costCode))

  const operationItems: ProjectSageSyncItem[] = operationRows
    .filter(
      (operation) =>
        operation.syncDirection === "write" ||
        operation.syncStatus !== "synced" ||
        operation.sageWriteStatus !== "not_ready"
    )
    .map((operation) => ({
      id: operation.id,
      kind: operationSyncKind(operation.sourceRecordType),
      table: "project_operations",
      title: operation.title,
      recordNumber: operation.sourceRecordNumber,
      status: operation.status,
      syncStatus: operation.syncStatus,
      sageWriteStatus: operation.sageWriteStatus,
      syncDirection: operation.syncDirection,
      amount: operation.amount,
      dueDate: operation.dueDate ?? operation.startDate,
      updatedAt: operation.updatedAt,
      detail: operation.companyName ?? operation.assigneeName,
    }))

  const applicationItems: ProjectSageSyncItem[] = applicationRows
    .filter((application) => application.syncStatus !== "synced")
    .map((application) => ({
      id: application.id,
      kind: "budget_application",
      table: "project_budget_applications",
      title: `Pay application ${application.applicationNumber}`,
      recordNumber: application.applicationNumber,
      status: application.status,
      syncStatus: application.syncStatus,
      sageWriteStatus: null,
      syncDirection: "read",
      amount: application.currentPaymentDue,
      dueDate: application.periodTo,
      updatedAt: application.updatedAt,
      detail: application.ownerVisible ? "Owner visible" : "Internal only",
    }))

  const budgetLineItems: ProjectSageSyncItem[] = budgetLineRows
    .filter((line) => line.syncStatus !== "synced")
    .slice(0, 25)
    .map((line) => ({
      id: line.id,
      kind: "budget_line",
      table: "project_budget_lines",
      title: line.description,
      recordNumber: line.costCode,
      status: "budget_line",
      syncStatus: line.syncStatus,
      sageWriteStatus: null,
      syncDirection: "read",
      amount: line.currentCosts,
      dueDate: null,
      updatedAt: line.updatedAt,
      detail: `${line.csiDivision} - ${line.csiDivisionName}`,
    }))

  const pendingItems = [
    ...operationItems,
    ...applicationItems,
    ...budgetLineItems,
  ]

  const counts = pendingItems.reduce(
    (summary, item) => {
      const status = syncQueueStatus(item)
      if (status === "queued") return { ...summary, queuedCount: summary.queuedCount + 1 }
      if (status === "blocked") return { ...summary, blockedCount: summary.blockedCount + 1 }
      return { ...summary, readyCount: summary.readyCount + 1 }
    },
    { readyCount: 0, queuedCount: 0, blockedCount: 0 }
  )

  return {
    pendingItems,
    readyCount: counts.readyCount,
    queuedCount: counts.queuedCount,
    blockedCount: counts.blockedCount,
  }
}

export async function queueProjectOperationForSageSync(
  projectId: string,
  operationId: string
): Promise<ProjectSyncActionResult> {
  try {
    const db = await verifyProjectUpdateAccess(projectId, "sage-sync")
    const [operation] = await db
      .select()
      .from(projectOperations)
      .where(
        and(
          eq(projectOperations.projectId, projectId),
          eq(projectOperations.id, operationId)
        )
      )
      .limit(1)

    if (!operation) return { success: false, error: "Sync item not found" }
    if (!operationCanQueueForSage(operation)) {
      return {
        success: false,
        error: "This item is not ready for Sage sync yet.",
      }
    }

    const now = new Date().toISOString()
    await db
      .update(projectOperations)
      .set({
        syncStatus: "queued_sage",
        sageWriteStatus: "queued",
        updatedAt: now,
      })
      .where(eq(projectOperations.id, operationId))

    await db
      .update(projectPurchaseOrderLines)
      .set({ syncStatus: "queued_sage", updatedAt: now })
      .where(eq(projectPurchaseOrderLines.operationId, operationId))

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/purchase-orders`)
    revalidatePath(`/dashboard/projects/${projectId}/daily-logs`)
    revalidatePath(`/dashboard/projects/${projectId}/schedule`)
    revalidatePath("/dashboard")
    return { success: true, updatedCount: 1 }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to queue Sage sync",
    }
  }
}

export async function queueProjectOperationsForSageSync(
  projectId: string
): Promise<ProjectSyncActionResult> {
  try {
    const db = await verifyProjectUpdateAccess(projectId, "sage-sync")
    const operations = await db
      .select()
      .from(projectOperations)
      .where(eq(projectOperations.projectId, projectId))

    const readyIds = operations
      .filter(operationCanQueueForSage)
      .map((operation) => operation.id)

    if (readyIds.length === 0) {
      return { success: false, error: "No Sage-ready items to queue." }
    }

    const now = new Date().toISOString()
    await db
      .update(projectOperations)
      .set({
        syncStatus: "queued_sage",
        sageWriteStatus: "queued",
        updatedAt: now,
      })
      .where(inArray(projectOperations.id, readyIds))

    await db
      .update(projectPurchaseOrderLines)
      .set({ syncStatus: "queued_sage", updatedAt: now })
      .where(inArray(projectPurchaseOrderLines.operationId, readyIds))

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/purchase-orders`)
    revalidatePath("/dashboard")
    return { success: true, updatedCount: readyIds.length }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to queue Sage sync",
    }
  }
}

export async function getProjectPurchaseOrders(
  projectId: string
): Promise<readonly ProjectPurchaseOrderItem[]> {
  const user = await requireAuth()
  const orgId = requireOrg(user)
  const db = await verifyProjectAccess(projectId, "purchase-orders")
  const rows = await db
    .select()
    .from(projectOperations)
    .where(
      and(
        eq(projectOperations.projectId, projectId),
        eq(projectOperations.sourceRecordType, "purchase_order")
      )
    )
    .orderBy(asc(projectOperations.dueDate), asc(projectOperations.title))

  if (rows.length === 0) return []

  const lines = await db
    .select()
    .from(projectPurchaseOrderLines)
    .where(
      inArray(
        projectPurchaseOrderLines.operationId,
        rows.map((row) => row.id)
      )
    )
    .orderBy(
      asc(projectPurchaseOrderLines.operationId),
      asc(projectPurchaseOrderLines.lineNumber)
    )

  const [contactRows, vendorRows] = await Promise.all([
    db
      .select({
        address: projectContacts.address,
        displayName: projectContacts.displayName,
        companyName: projectContacts.companyName,
        email: projectContacts.email,
      })
      .from(projectContacts)
      .where(and(eq(projectContacts.projectId, projectId), eq(projectContacts.active, true))),
    db
      .select({
        address: vendors.address,
        name: vendors.name,
        email: vendors.email,
        netsuiteId: vendors.netsuiteId,
        sourceRecordId: vendors.sourceRecordId,
        sourceRecordNumber: vendors.sourceRecordNumber,
      })
      .from(vendors)
      .where(eq(vendors.organizationId, orgId)),
  ])

  const linesByOperation = new Map<string, ProjectPurchaseOrderLineItem[]>()
  for (const line of lines.map(toPurchaseOrderLineItem)) {
    const existing = linesByOperation.get(line.operationId) ?? []
    existing.push(line)
    linesByOperation.set(line.operationId, existing)
  }

  return rows.map((row) => {
    const vendorDetails = purchaseOrderVendorDetails({
      order: row,
      contacts: contactRows,
      vendors: vendorRows,
    })

    return {
      ...toOperationItem(row),
      lines: linesByOperation.get(row.id) ?? [],
      vendorAddress: vendorDetails.address,
      vendorEmail: vendorDetails.email,
      vendorAcknowledgement: parsePortalPurchaseOrderPayload(row.sagePayloadJson)
        .acknowledgement,
    }
  })
}

export async function getProjectPurchaseOrderFormOptions(
  projectId: string
): Promise<ProjectPurchaseOrderFormOptions> {
  const db = await verifyProjectAccess(projectId, "purchase-orders")
  const [projectRows, sageRows, budgetRows] = await Promise.all([
    db
      .select({ address: projects.address })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1),
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

  const phaseMap = new Map<string, ProjectPurchaseOrderPhaseOption>()
  const costCodeMap = new Map<string, ProjectPurchaseOrderCostCodeOption>()

  for (const row of sageRows) {
    phaseMap.set(row.divisionCode, {
      value: row.divisionCode,
      label: row.divisionDisplayLabel,
    })
    costCodeMap.set(row.code, {
      value: row.code,
      label: row.displayLabel,
      description: row.description,
      divisionCode: row.divisionCode,
    })
  }

  for (const row of budgetRows) {
    if (!phaseMap.has(row.divisionCode)) {
      phaseMap.set(row.divisionCode, {
        value: row.divisionCode,
        label: `${row.divisionCode} 00 00 ${row.divisionName}`,
      })
    }
    if (!costCodeMap.has(row.costCode)) {
      costCodeMap.set(row.costCode, {
        value: row.costCode,
        label: `${row.costCode} ${row.description}`,
        description: row.description,
        divisionCode: row.divisionCode,
      })
    }
  }

  return {
    jobsiteAddress: cleanText(projectRows[0]?.address ?? null),
    phases: Array.from(phaseMap.values()).sort((left, right) =>
      left.label.localeCompare(right.label)
    ),
    costCodes: Array.from(costCodeMap.values()).sort((left, right) =>
      left.label.localeCompare(right.label)
    ),
  }
}

export async function getProjectRfqs(
  projectId: string
): Promise<readonly ProjectRfqItem[]> {
  const user = await requireAuth()
  const orgId = requireOrg(user)
  const db = await verifyProjectAccess(projectId, "rfqs")
  const rows = await db
    .select()
    .from(projectOperations)
    .where(
      and(
        eq(projectOperations.projectId, projectId),
        eq(projectOperations.sourceRecordType, "rfq")
      )
    )
    .orderBy(asc(projectOperations.dueDate), asc(projectOperations.title))

  if (rows.length === 0) return []

  const [contactRows, vendorRows] = await Promise.all([
    db
      .select({
        address: projectContacts.address,
        displayName: projectContacts.displayName,
        companyName: projectContacts.companyName,
        email: projectContacts.email,
      })
      .from(projectContacts)
      .where(
        and(eq(projectContacts.projectId, projectId), eq(projectContacts.active, true))
      ),
    db
      .select({
        address: vendors.address,
        name: vendors.name,
        email: vendors.email,
        netsuiteId: vendors.netsuiteId,
        sourceRecordId: vendors.sourceRecordId,
        sourceRecordNumber: vendors.sourceRecordNumber,
      })
      .from(vendors)
      .where(eq(vendors.organizationId, orgId)),
  ])

  return rows.map((row) =>
    toRfqItem(
      row,
      purchaseOrderVendorDetails({
        order: row,
        contacts: contactRows,
        vendors: vendorRows,
      }).email
    )
  )
}

export async function updateProjectOperationStatus(
  projectId: string,
  operationId: string,
  operationKind: ProjectOperationKind,
  requestedStatus: string
): Promise<ProjectOperationActionResult> {
  try {
    const db = await verifyProjectUpdateAccess(
      projectId,
      operationKind === "purchase_order" ? "purchase-orders" : "rfqs"
    )
    const statusIsValid =
      operationKind === "purchase_order"
        ? isPurchaseOrderStatus(requestedStatus)
        : isRfqStatus(requestedStatus)

    if (!statusIsValid) {
      return { success: false, error: "Please choose a valid status." }
    }

    const existing = await db
      .select({ id: projectOperations.id })
      .from(projectOperations)
      .where(
        and(
          eq(projectOperations.id, operationId),
          eq(projectOperations.projectId, projectId),
          eq(projectOperations.sourceRecordType, operationKind)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (!existing) {
      return {
        success: false,
        error:
          operationKind === "purchase_order"
            ? "Purchase order not found."
            : "RFQ not found.",
      }
    }

    await db
      .update(projectOperations)
      .set({
        status: requestedStatus,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(projectOperations.id, operationId),
          eq(projectOperations.projectId, projectId),
          eq(projectOperations.sourceRecordType, operationKind)
        )
      )

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(
      `/dashboard/projects/${projectId}/${
        operationKind === "purchase_order" ? "purchase-orders" : "rfqs"
      }`
    )
    revalidatePath("/dashboard/purchase-orders")
    revalidatePath("/dashboard/financials")
    revalidatePath("/dashboard/schedule")
    revalidatePath("/dashboard")
    if (operationKind === "rfq") {
      revalidatePath(`/preview/projects/${projectId}/sub-vendor/rfqs`)
    }

    return { success: true, id: operationId }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to update status.",
    }
  }
}

export async function createPurchaseOrderRequest(
  projectId: string,
  input: CreatePurchaseOrderRequestInput
): Promise<ProjectOperationActionResult> {
  try {
    const db = await verifyProjectUpdateAccess(
      projectId,
      "purchase-orders"
    )
    const [project] = await db
      .select({
        projectNumber: projects.projectNumber,
        sageJobId: projects.sageJobId,
        sageJobNumber: projects.sageJobNumber,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)

    const purchaseOrders = await db
      .select({ id: projectOperations.id })
      .from(projectOperations)
      .where(
        and(
          eq(projectOperations.projectId, projectId),
          eq(projectOperations.sourceRecordType, "purchase_order")
        )
      )

    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const sourceRecordNumber = purchaseOrderRequestNumberFor(
      project?.projectNumber ?? null,
      purchaseOrders.length,
      id
    )
    const title = requireText(input.title, "Title")
    const description = cleanText(input.description)
    const companyName = cleanText(input.companyName)
    const shipTo = cleanText(input.shipTo)
    const orderDate = cleanText(input.orderDate) ?? now.slice(0, 10)
    const dueDate = cleanText(input.dueDate)
    const lines = normalizePurchaseOrderLines(input.lines, description ?? title)
    const amount = lines.reduce((total, line) => total + line.amount, 0)
    const headerCostCode = lines.length === 1 ? lines[0]?.costCode ?? null : null
    const headerPhaseCode = lines.length === 1 ? lines[0]?.phaseCode ?? null : null
    const headerTaxGroup = lines.length === 1 ? lines[0]?.taxGroup ?? null : null
    const sagePayload = buildSagePurchaseOrderPayload({
      project: project ?? { sageJobId: null, sageJobNumber: null },
      sourceRecordNumber,
      title,
      description,
      companyName,
      sageVendorId: cleanText(input.sageVendorId),
      shipTo,
      orderDate,
      dueDate,
      lines,
    })
    const sagePayloadJson = JSON.stringify(sagePayload)
    const inserted: typeof projectOperations.$inferInsert = {
      id,
      projectId,
      sourceSystem: "compass",
      sourceRecordType: "purchase_order",
      sourceRecordNumber,
      title,
      description,
      status: "draft",
      priority: input.priority,
      assigneeType: "vendor",
      assigneeName: cleanText(input.assigneeName),
      siteContactPhone: cleanText(input.siteContactPhone),
      companyName,
      costCode: headerCostCode,
      dueDate,
      amount,
      sageJobId: project?.sageJobId ?? null,
      sageJobNumber: project?.sageJobNumber ?? null,
      sageVendorId: cleanText(input.sageVendorId),
      sageVendorName: companyName,
      sagePhaseCode: headerPhaseCode,
      sageCostCode: headerCostCode,
      sageTaxGroup: headerTaxGroup,
      sageShipTo: shipTo,
      sageOrderDate: orderDate,
      sageRequiredDate: dueDate,
      sageWriteStatus: "draft_ready",
      sagePayloadJson,
      syncDirection: "write",
      syncStatus: "pending_sage",
      createdAt: now,
      updatedAt: now,
    }

    const lineInserts = lines.map((line) =>
      db.insert(projectPurchaseOrderLines).values({
        id: crypto.randomUUID(),
        operationId: id,
        projectId,
        sourceSystem: "compass",
        sourceRecordId: null,
        lineNumber: line.lineNumber,
        costCode: line.costCode,
        phaseCode: line.phaseCode,
        description: line.description,
        quantity: line.quantity,
        unitCost: line.unitCost,
        unit: line.unit,
        amount: line.amount,
        taxGroup: line.taxGroup,
        sagePayloadJson: JSON.stringify(line),
        syncStatus: "pending_sage",
        createdAt: now,
        updatedAt: now,
      })
    )

    // D1 permits at most 100 bound parameters per statement. Keep each line in
    // its own statement and batch the header plus lines so the write is atomic.
    await db.batch([
      db.insert(projectOperations).values(inserted),
      ...lineInserts,
    ])
    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/purchase-orders`)
    revalidatePath("/dashboard/purchase-orders")
    revalidatePath("/dashboard/financials")
    revalidatePath("/dashboard/schedule")

    return { success: true, id }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to create purchase order request",
    }
  }
}

export async function updatePurchaseOrderRequest(
  projectId: string,
  purchaseOrderId: string,
  input: UpdatePurchaseOrderRequestInput
): Promise<ProjectOperationActionResult> {
  try {
    const db = await verifyProjectUpdateAccess(
      projectId,
      "purchase-orders"
    )
    const [existing] = await db
      .select()
      .from(projectOperations)
      .where(
        and(
          eq(projectOperations.id, purchaseOrderId),
          eq(projectOperations.projectId, projectId),
          eq(projectOperations.sourceRecordType, "purchase_order")
        )
      )
      .limit(1)

    if (!existing) {
      throw new Error("Purchase order not found")
    }
    if (!canEditPurchaseOrderDraft(existing)) {
      throw new Error(
        "This purchase order can no longer be edited because it was sent or queued for Sage."
      )
    }
    if (existing.updatedAt !== input.expectedUpdatedAt) {
      throw new Error(
        "This purchase order changed after you opened it. Refresh and try again."
      )
    }
    if (!existing.sourceRecordNumber) {
      throw new Error("Purchase order number is missing")
    }

    const now = new Date().toISOString()
    const title = requireText(input.title, "Title")
    const description = cleanText(input.description)
    const companyName = cleanText(input.companyName)
    const sageVendorId = cleanText(input.sageVendorId)
    const shipTo = cleanText(input.shipTo)
    const orderDate = cleanDate(input.orderDate, "P.O. date")
    const dueDate = cleanDate(input.dueDate, "Required date")
    const lines = normalizePurchaseOrderLines(
      input.lines,
      description ?? title,
      { allowEmpty: true },
    )
    const amount = lines.reduce((total, line) => total + line.amount, 0)
    const headerCostCode = lines.length === 1 ? lines[0]?.costCode ?? null : null
    const headerPhaseCode = lines.length === 1 ? lines[0]?.phaseCode ?? null : null
    const headerTaxGroup = lines.length === 1 ? lines[0]?.taxGroup ?? null : null
    const sagePayloadJson = JSON.stringify(
      buildSagePurchaseOrderPayload({
        project: {
          sageJobId: existing.sageJobId,
          sageJobNumber: existing.sageJobNumber,
        },
        sourceRecordNumber: existing.sourceRecordNumber,
        title,
        description,
        companyName,
        sageVendorId,
        shipTo,
        orderDate,
        dueDate,
        lines,
      })
    )

    const lineInserts = lines.map((line) =>
      db.insert(projectPurchaseOrderLines).values({
        id: crypto.randomUUID(),
        operationId: purchaseOrderId,
        projectId,
        sourceSystem: "compass",
        sourceRecordId: null,
        lineNumber: line.lineNumber,
        costCode: line.costCode,
        phaseCode: line.phaseCode,
        description: line.description,
        quantity: line.quantity,
        unitCost: line.unitCost,
        unit: line.unit,
        amount: line.amount,
        taxGroup: line.taxGroup,
        sagePayloadJson: JSON.stringify(line),
        syncStatus: "pending_sage",
        createdAt: now,
        updatedAt: now,
      })
    )

    await db.batch([
      db
        .update(projectOperations)
        .set({
          title,
          description,
          priority: input.priority,
          assigneeName: cleanText(input.assigneeName),
          siteContactPhone: cleanText(input.siteContactPhone),
          companyName,
          costCode: headerCostCode,
          dueDate,
          amount,
          sageVendorId,
          sageVendorName: companyName,
          sagePhaseCode: headerPhaseCode,
          sageCostCode: headerCostCode,
          sageTaxGroup: headerTaxGroup,
          sageShipTo: shipTo,
          sageOrderDate: orderDate,
          sageRequiredDate: dueDate,
          sagePayloadJson,
          updatedAt: now,
        })
        .where(
          and(
            eq(projectOperations.id, purchaseOrderId),
            eq(projectOperations.projectId, projectId),
            eq(projectOperations.updatedAt, input.expectedUpdatedAt)
          )
        ),
      db
        .delete(projectPurchaseOrderLines)
        .where(
          and(
            eq(projectPurchaseOrderLines.operationId, purchaseOrderId),
            eq(projectPurchaseOrderLines.projectId, projectId)
          )
        ),
      ...lineInserts,
    ])

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/purchase-orders`)
    revalidatePath("/dashboard/purchase-orders")
    revalidatePath("/dashboard/financials")
    revalidatePath("/dashboard/schedule")

    return { success: true, id: purchaseOrderId }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to update purchase order request",
    }
  }
}

export async function createRfqRequest(
  projectId: string,
  input: CreateRfqRequestInput
): Promise<ProjectOperationActionResult> {
  try {
    const db = await verifyProjectUpdateAccess(projectId, "rfqs")
    const [project] = await db
      .select({
        projectNumber: projects.projectNumber,
        sageJobId: projects.sageJobId,
        sageJobNumber: projects.sageJobNumber,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)

    const rfqs = await db
      .select({ id: projectOperations.id })
      .from(projectOperations)
      .where(
        and(
          eq(projectOperations.projectId, projectId),
          eq(projectOperations.sourceRecordType, "rfq")
        )
      )

    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const title = requireText(input.title, "Title")
    const description = cleanText(input.scope)
    const requestedFrom = cleanText(input.requestedFrom)
    const vendorCategory = cleanText(input.vendorCategory)
    const recipientEmail = cleanText(input.recipientEmail)
    const responseDueDate = cleanText(input.responseDueDate)
    const scopeItems = normalizeRfqScopeLines(
      input.scopeItems,
      description ?? title
    )
    const documentLinks = normalizeRfqDocumentLinks(input.documentLinks)
    const primaryLine = scopeItems[0] ?? null
    const sourceRecordNumber = projectDocumentNumberFor(
      project?.projectNumber ?? null,
      "RFQ",
      rfqs.length
    )
    const sageShortRecordNumber = sageShortProjectDocumentNumberFor(
      project?.projectNumber ?? null,
      "RFQ",
      rfqs.length
    )
    const payload = {
      source: "compass_rfq",
      jobId: project?.sageJobId ?? null,
      jobNumber: project?.sageJobNumber ?? null,
      rfqNumber: sourceRecordNumber,
      sageShortRfqNumber: sageShortRecordNumber,
      title,
      vendorCategory,
      requestedFrom,
      recipientEmail,
      responseDueDate,
      scope: description,
      scopeItems,
      documentLinks,
      sageRfp: {
        targetRecordType: "sage_rfp",
        linkStrategy: "external_document_links",
        suggestedRecordNumber: sageShortRecordNumber,
        writeStatus: "not_ready",
      },
    }

    await db.insert(projectOperations).values({
      id,
      projectId,
      sourceSystem: "compass",
      sourceRecordType: "rfq",
      sourceRecordNumber,
      title,
      description,
      status: "draft",
      priority: cleanText(input.priority) ?? "normal",
      assigneeType: "vendor",
      assigneeName: requestedFrom,
      companyName: requestedFrom ?? vendorCategory,
      costCode: primaryLine?.costCode ?? null,
      dueDate: responseDueDate,
      sageJobId: project?.sageJobId ?? null,
      sageJobNumber: project?.sageJobNumber ?? null,
      sageVendorName: requestedFrom,
      sagePhaseCode: primaryLine?.phaseCode ?? null,
      sageCostCode: primaryLine?.costCode ?? null,
      sageWriteStatus: "not_ready",
      sagePayloadJson: JSON.stringify(payload),
      syncDirection: "write",
      syncStatus: "compass_only",
      createdAt: now,
      updatedAt: now,
    })

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/rfqs`)
    revalidatePath(`/dashboard/projects/${projectId}/financials`)
    revalidatePath("/dashboard")

    return { success: true, id }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to create request for quote",
    }
  }
}

export async function deletePurchaseOrderRequest(
  projectId: string,
  purchaseOrderId: string
): Promise<ProjectOperationActionResult> {
  try {
    const db = await verifyProjectUpdateAccess(
      projectId,
      "purchase-orders"
    )
    const [existing] = await db
      .select({ id: projectOperations.id })
      .from(projectOperations)
      .where(
        and(
          eq(projectOperations.id, purchaseOrderId),
          eq(projectOperations.projectId, projectId),
          eq(projectOperations.sourceRecordType, "purchase_order")
        )
      )
      .limit(1)

    if (!existing) {
      return { success: false, error: "Purchase order not found." }
    }

    await db
      .delete(projectPurchaseOrderLines)
      .where(
        and(
          eq(projectPurchaseOrderLines.operationId, purchaseOrderId),
          eq(projectPurchaseOrderLines.projectId, projectId)
        )
      )
    await db
      .delete(projectOperations)
      .where(
        and(
          eq(projectOperations.id, purchaseOrderId),
          eq(projectOperations.projectId, projectId),
          eq(projectOperations.sourceRecordType, "purchase_order")
        )
      )

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/purchase-orders`)
    revalidatePath(`/dashboard/projects/${projectId}/financials`)
    revalidatePath("/dashboard")
    revalidatePath("/dashboard/purchase-orders")
    revalidatePath("/dashboard/financials")
    revalidatePath("/dashboard/schedule")

    return { success: true, id: purchaseOrderId }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to delete purchase order",
    }
  }
}

export async function updateRfqRequest(
  projectId: string,
  rfqId: string,
  input: UpdateRfqRequestInput
): Promise<ProjectOperationActionResult> {
  try {
    const db = await verifyProjectUpdateAccess(projectId, "rfqs")
    const [project, existing] = await Promise.all([
      db
        .select({
          projectNumber: projects.projectNumber,
          sageJobId: projects.sageJobId,
          sageJobNumber: projects.sageJobNumber,
        })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1),
      db
        .select()
        .from(projectOperations)
        .where(
          and(
            eq(projectOperations.id, rfqId),
            eq(projectOperations.projectId, projectId),
            eq(projectOperations.sourceRecordType, "rfq")
          )
        )
        .limit(1),
    ])

    if (!existing[0]) {
      return { success: false, error: "RFQ not found." }
    }

    const now = new Date().toISOString()
    const title = requireText(input.title, "Title")
    const description = cleanText(input.scope)
    const requestedFrom = cleanText(input.requestedFrom)
    const vendorCategory = cleanText(input.vendorCategory)
    const recipientEmail = cleanText(input.recipientEmail)
    const responseDueDate = cleanText(input.responseDueDate)
    const scopeItems = normalizeRfqScopeLines(
      input.scopeItems,
      description ?? title
    )
    const documentLinks = normalizeRfqDocumentLinks(input.documentLinks)
    const existingPayload = parseJsonRecord(existing[0].sagePayloadJson)
    const existingVendorResponse = parsePortalRfqPayload(
      existing[0].sagePayloadJson
    ).vendorResponse
    const existingTemplateReview = parseRfqTemplateReview(existingPayload)
    const unresolvedPlaceholders = existingTemplateReview
      ? findTemplatePlaceholders(
          [
            title,
            description,
            ...scopeItems.flatMap((line) => [line.description, line.notes]),
          ]
        )
      : []
    const templateReview = existingTemplateReview
      ? {
          unresolvedPlaceholders,
          requiresDocumentPackage:
            existingTemplateReview.requiresDocumentPackage &&
            documentLinks.length === 0,
        }
      : null
    const primaryLine = scopeItems[0] ?? null
    const sourceRecordNumber =
      existing[0].sourceRecordNumber ??
      projectDocumentNumberFor(project[0]?.projectNumber ?? null, "RFQ", 0)
    const sageShortRecordNumber = sageShortProjectDocumentNumberFor(
      project[0]?.projectNumber ?? null,
      "RFQ",
      0
    )
    const payload = {
      source: "compass_rfq",
      jobId: project[0]?.sageJobId ?? null,
      jobNumber: project[0]?.sageJobNumber ?? null,
      rfqNumber: sourceRecordNumber,
      sageShortRfqNumber: sageShortRecordNumber,
      title,
      vendorCategory,
      requestedFrom,
      recipientEmail,
      responseDueDate,
      scope: description,
      scopeItems,
      documentLinks,
      vendorResponse: existingVendorResponse,
      templateReview:
        templateReview &&
        (templateReview.unresolvedPlaceholders.length > 0 ||
          templateReview.requiresDocumentPackage)
          ? templateReview
          : null,
      sageRfp: {
        targetRecordType: "sage_rfp",
        linkStrategy: "external_document_links",
        suggestedRecordNumber: sageShortRecordNumber,
        writeStatus: "not_ready",
      },
    }

    await db
      .update(projectOperations)
      .set({
        title,
        description,
        priority: cleanText(input.priority) ?? "normal",
        assigneeType: "vendor",
        assigneeName: requestedFrom,
        companyName: requestedFrom ?? vendorCategory,
        costCode: primaryLine?.costCode ?? null,
        dueDate: responseDueDate,
        sageJobId: project[0]?.sageJobId ?? null,
        sageJobNumber: project[0]?.sageJobNumber ?? null,
        sageVendorName: requestedFrom,
        sagePhaseCode: primaryLine?.phaseCode ?? null,
        sageCostCode: primaryLine?.costCode ?? null,
        sagePayloadJson: JSON.stringify(payload),
        syncStatus:
          existing[0].syncStatus === "pending_sage"
            ? "pending_sage"
            : "compass_only",
        updatedAt: now,
      })
      .where(
        and(
          eq(projectOperations.id, rfqId),
          eq(projectOperations.projectId, projectId)
        )
      )

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/rfqs`)
    revalidatePath(`/dashboard/projects/${projectId}/financials`)
    revalidatePath("/dashboard")

    return { success: true, id: rfqId }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to update request for quote",
    }
  }
}

export async function deleteRfqRequest(
  projectId: string,
  rfqId: string
): Promise<ProjectOperationActionResult> {
  try {
    const db = await verifyProjectUpdateAccess(projectId, "rfqs")
    const [existing] = await db
      .select({ id: projectOperations.id })
      .from(projectOperations)
      .where(
        and(
          eq(projectOperations.id, rfqId),
          eq(projectOperations.projectId, projectId),
          eq(projectOperations.sourceRecordType, "rfq")
        )
      )
      .limit(1)

    if (!existing) {
      return { success: false, error: "RFQ not found." }
    }

    await db
      .delete(projectOperations)
      .where(
        and(
          eq(projectOperations.id, rfqId),
          eq(projectOperations.projectId, projectId),
          eq(projectOperations.sourceRecordType, "rfq")
        )
      )

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/rfqs`)
    revalidatePath(`/dashboard/projects/${projectId}/financials`)
    revalidatePath("/dashboard")

    return { success: true, id: rfqId }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to delete request for quote",
    }
  }
}

export async function createProjectTask(
  projectId: string,
  input: CreateProjectTaskInput
): Promise<ProjectOperationActionResult> {
  try {
    const user = await requireAuth()
    const organizationId = requireOrg(user)
    const db = await verifyProjectUpdateAccess(projectId, "tasks")
    const [project] = await db
      .select({
        sageJobId: projects.sageJobId,
        sageJobNumber: projects.sageJobNumber,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)

    const taskRows = await db
      .select({ id: projectOperations.id })
      .from(projectOperations)
      .where(
        and(
          eq(projectOperations.projectId, projectId),
          inArray(projectOperations.sourceRecordType, [
            ...PROJECT_TODO_RECORD_TYPES,
          ])
        )
      )

    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const title = requireText(input.title, "Title")
    const sourceRecordType = normalizeTaskRecordType(input.sourceRecordType)
    const dueDate = cleanText(input.dueDate)
    const startDate = cleanText(input.startDate)

    await db.insert(projectOperations).values({
      id,
      projectId,
      sourceSystem: "compass",
      sourceRecordType,
      sourceRecordId: cleanText(input.sourceRecordId),
      sourceRecordNumber: projectTaskNumberFor(taskRows.length),
      title,
      description: cleanText(input.description),
      status: "open",
      priority: cleanText(input.priority) ?? "normal",
      assigneeType: assigneeTypeForTask(sourceRecordType),
      assigneeName: cleanText(input.assigneeName),
      companyName: cleanText(input.companyName),
      startDate,
      dueDate,
      externalUrl: cleanText(input.externalUrl),
      sageJobId: project?.sageJobId ?? null,
      sageJobNumber: project?.sageJobNumber ?? null,
      sageWriteStatus: "not_ready",
      sagePayloadJson: JSON.stringify({
        source: "compass_task",
        linkedRecordId: cleanText(input.sourceRecordId),
        linkedRecordNumber: cleanText(input.sourceRecordNumber),
        taskType: sourceRecordType,
        title,
        description: cleanText(input.description),
        assigneeName: cleanText(input.assigneeName),
        companyName: cleanText(input.companyName),
        startDate,
        dueDate,
        priority: cleanText(input.priority) ?? "normal",
      }),
      syncDirection: "write",
      syncStatus: "compass_only",
      createdAt: now,
      updatedAt: now,
    })

    try {
      await notifyProjectAssignment({
        organizationId,
        projectId,
        itemId: id,
        title,
        assignedToName: cleanText(input.assigneeName),
        createdBy: user,
        kind: "task",
      })
    } catch (notificationError) {
      console.error(
        "Project task assignment notification failed:",
        notificationError
      )
    }

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/rfis`)
    revalidatePath(`/dashboard/projects/${projectId}/rfqs`)
    revalidatePath(`/dashboard/projects/${projectId}/purchase-orders`)
    revalidateProjectTodoPaths(projectId)

    return { success: true, id }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to create project task",
    }
  }
}

async function findEditableProjectTodo(
  projectId: string,
  todoId: string,
  expectedUpdatedAt: string
): Promise<{
  readonly db: ReturnType<typeof getDb>
  readonly operation: typeof projectOperations.$inferSelect
}> {
  const db = await verifyProjectUpdateAccess(projectId, "tasks")
  const [operation] = await db
    .select()
    .from(projectOperations)
    .where(
      and(
        eq(projectOperations.id, todoId),
        eq(projectOperations.projectId, projectId)
      )
    )
    .limit(1)

  if (!operation || !isProjectTodoRecordType(operation.sourceRecordType)) {
    throw new Error("To-do not found")
  }
  if (operation.updatedAt !== expectedUpdatedAt) {
    throw new Error(
      "This to-do changed after you opened it. Refresh and review the latest version."
    )
  }

  return { db, operation }
}

export async function updateProjectTodo(
  projectId: string,
  todoId: string,
  input: UpdateProjectTodoInput
): Promise<ProjectTodoActionResult> {
  try {
    const user = await requireAuth()
    const organizationId = requireOrg(user)
    const { db, operation } = await findEditableProjectTodo(
      projectId,
      todoId,
      input.expectedUpdatedAt
    )
    if (!isProjectTodoStatus(input.status)) {
      return { success: false, error: "Choose a valid to-do status." }
    }
    const sourceRecordType = normalizeTaskRecordType(input.sourceRecordType)
    const title = requireText(input.title, "Title")
    const assigneeName = cleanText(input.assigneeName)
    const companyName = cleanText(input.companyName)
    const startDate = cleanDate(input.startDate, "Start date")
    const dueDate = cleanDate(input.dueDate, "Due date")
    if (startDate && dueDate && dueDate < startDate) {
      return {
        success: false,
        error: "Due date must be on or after the start date.",
      }
    }

    const updatedAt = new Date().toISOString()
    const updatedRows = await db
      .update(projectOperations)
      .set({
        sourceRecordType,
        title,
        description: cleanText(input.description),
        status: input.status,
        priority: cleanText(input.priority) ?? "normal",
        assigneeType: assigneeTypeForTask(sourceRecordType),
        assigneeName,
        companyName,
        startDate,
        dueDate,
        updatedAt,
      })
      .where(
        and(
          eq(projectOperations.id, todoId),
          eq(projectOperations.projectId, projectId),
          eq(projectOperations.updatedAt, input.expectedUpdatedAt)
        )
      )
      .returning({
        id: projectOperations.id,
        updatedAt: projectOperations.updatedAt,
      })
    const updated = updatedRows[0]
    if (!updated) {
      return {
        success: false,
        error:
          "This to-do changed while you were saving. Refresh and review the latest version.",
      }
    }

    if (assigneeName && assigneeName !== operation.assigneeName) {
      try {
        await notifyProjectAssignment({
          organizationId,
          projectId,
          itemId: todoId,
          title,
          assignedToName: assigneeName,
          createdBy: user,
          kind: "task",
        })
      } catch (notificationError) {
        console.error(
          "Updated project task assignment notification failed:",
          notificationError
        )
      }
    }

    revalidateProjectTodoPaths(projectId)
    return { success: true, id: updated.id, updatedAt: updated.updatedAt }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to update to-do",
    }
  }
}

export async function setProjectTodoStatus(
  projectId: string,
  todoId: string,
  status: ProjectTodoStatus,
  expectedUpdatedAt: string
): Promise<ProjectTodoActionResult> {
  try {
    if (!isProjectTodoStatus(status)) {
      return { success: false, error: "Choose a valid to-do status." }
    }
    const { db } = await findEditableProjectTodo(
      projectId,
      todoId,
      expectedUpdatedAt
    )
    const updatedAt = new Date().toISOString()
    const updatedRows = await db
      .update(projectOperations)
      .set({ status, updatedAt })
      .where(
        and(
          eq(projectOperations.id, todoId),
          eq(projectOperations.projectId, projectId),
          eq(projectOperations.updatedAt, expectedUpdatedAt)
        )
      )
      .returning({
        id: projectOperations.id,
        updatedAt: projectOperations.updatedAt,
      })
    const updated = updatedRows[0]
    if (!updated) {
      return {
        success: false,
        error:
          "This to-do changed while you were saving. Refresh and review the latest version.",
      }
    }

    revalidateProjectTodoPaths(projectId)
    return { success: true, id: updated.id, updatedAt: updated.updatedAt }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to change to-do status",
    }
  }
}

export async function archiveProjectTodo(
  projectId: string,
  todoId: string,
  expectedUpdatedAt: string
): Promise<ProjectTodoActionResult> {
  try {
    const { db } = await findEditableProjectTodo(
      projectId,
      todoId,
      expectedUpdatedAt
    )
    const updatedAt = new Date().toISOString()
    const updatedRows = await db
      .update(projectOperations)
      .set({ status: "archived", updatedAt })
      .where(
        and(
          eq(projectOperations.id, todoId),
          eq(projectOperations.projectId, projectId),
          eq(projectOperations.updatedAt, expectedUpdatedAt)
        )
      )
      .returning({
        id: projectOperations.id,
        updatedAt: projectOperations.updatedAt,
      })
    const updated = updatedRows[0]
    if (!updated) {
      return {
        success: false,
        error:
          "This to-do changed while you were archiving it. Refresh and review the latest version.",
      }
    }

    revalidateProjectTodoPaths(projectId)
    return { success: true, id: updated.id, updatedAt: updated.updatedAt }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to archive to-do",
    }
  }
}

export async function restoreProjectTodo(
  projectId: string,
  todoId: string,
  expectedUpdatedAt: string
): Promise<ProjectTodoActionResult> {
  return setProjectTodoStatus(projectId, todoId, "open", expectedUpdatedAt)
}

export async function deleteProjectTodo(
  projectId: string,
  todoId: string,
  expectedUpdatedAt: string
): Promise<ProjectTodoActionResult> {
  try {
    const { db, operation } = await findEditableProjectTodo(
      projectId,
      todoId,
      expectedUpdatedAt
    )
    if (!isArchivedProjectTodoStatus(operation.status)) {
      return {
        success: false,
        error: "Archive the to-do before deleting it permanently.",
      }
    }
    const deletedRows = await db
      .delete(projectOperations)
      .where(
        and(
          eq(projectOperations.id, todoId),
          eq(projectOperations.projectId, projectId),
          eq(projectOperations.updatedAt, expectedUpdatedAt)
        )
      )
      .returning({ id: projectOperations.id })
    const deleted = deletedRows[0]
    if (!deleted) {
      return {
        success: false,
        error:
          "This to-do changed while you were deleting it. Refresh and review the latest version.",
      }
    }

    revalidateProjectTodoPaths(projectId)
    return { success: true, id: deleted.id, updatedAt: expectedUpdatedAt }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to delete to-do",
    }
  }
}

export async function sendPurchaseOrderEmail(
  projectId: string,
  purchaseOrderId: string,
  input: SendPurchaseOrderEmailInput
): Promise<ProjectOperationEmailActionResult> {
  try {
    const user = await requireAuth()
    await requireFeaturePermission(user, "purchase-orders", "update")
    const orgId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const to = parseEmailList(input.to)
    const cc = parseEmailList(input.cc)
    const subject = requireText(input.subject, "Subject")
    const message = requireText(input.message, "Message")

    if (to.length === 0) {
      return { success: false, error: "Enter at least one supplier email." }
    }

    const [project] = await db
      .select({
        id: projects.id,
        name: projects.name,
        projectNumber: projects.projectNumber,
        address: projects.address,
      })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
      .limit(1)

    if (!project) {
      return { success: false, error: "Project not found." }
    }

    const [operation] = await db
      .select()
      .from(projectOperations)
      .where(
        and(
          eq(projectOperations.id, purchaseOrderId),
          eq(projectOperations.projectId, projectId),
          eq(projectOperations.sourceRecordType, "purchase_order")
        )
      )
      .limit(1)

    if (!operation) {
      return { success: false, error: "Purchase order not found." }
    }

    const lineRows = await db
      .select()
      .from(projectPurchaseOrderLines)
      .where(eq(projectPurchaseOrderLines.operationId, purchaseOrderId))
      .orderBy(asc(projectPurchaseOrderLines.lineNumber))

    const order: ProjectPurchaseOrderItem = {
      ...toOperationItem(operation),
      lines: lineRows.map(toPurchaseOrderLineItem),
      vendorAddress: null,
      vendorEmail: null,
      vendorAcknowledgement: parsePortalPurchaseOrderPayload(
        operation.sagePayloadJson
      ).acknowledgement,
    }
    const senderName = user.displayName ?? user.email
    const emailInput = {
      brand: projectBrandFor({
        projectId: project.id,
        projectNumber: project.projectNumber,
      }),
      projectName: project.name,
      projectNumber: project.projectNumber,
      senderName,
      message,
      deliveryLocation: resolvedPurchaseOrderShipTo({
        storedShipTo: order.sageShipTo,
        jobsiteAddress: project.address,
      }),
      order,
    }
    const delivery = await sendResendPurchaseOrderEmail(env, {
      to,
      cc,
      subject,
      text: purchaseOrderEmailText(emailInput),
      html: purchaseOrderEmailHtml(emailInput),
    })

    if (delivery.status === "failed") {
      return {
        success: false,
        error: delivery.error ?? "Unable to send purchase order email.",
      }
    }

    const now = new Date().toISOString()
    await db
      .update(projectOperations)
      .set({
        status: purchaseOrderStatusAfterEmail(operation.status),
        sagePayloadJson: withPortalPurchaseOrderRecipients(
          operation.sagePayloadJson,
          [...to, ...cc]
        ),
        updatedAt: now,
      })
      .where(eq(projectOperations.id, purchaseOrderId))

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/purchase-orders`)
    revalidatePath("/dashboard/purchase-orders")

    return {
      success: true,
      status: delivery.status,
      providerMessageId: delivery.providerMessageId,
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to send purchase order email.",
    }
  }
}
