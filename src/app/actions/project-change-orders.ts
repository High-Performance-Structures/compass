"use server"

import { and, asc, desc, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getUploadSessionUrl } from "@/app/actions/google-drive"
import { getDb } from "@/db"
import {
  projectBudgetLines,
  projectChangeOrderDocuments,
  projectChangeOrderHistory,
  projectChangeOrderLines,
  projectChangeOrders,
  projectContacts,
  projectMembers,
  projects,
  sageCostCodes,
} from "@/db/schema"
import { projectEstimates } from "@/db/schema-estimates"
import { requireAuth, type AuthUser } from "@/lib/auth"
import {
  changeOrderCostLinesTotalCents,
  cleanChangeOrderCostLines,
  cleanScheduleImpactDays,
  type ChangeOrderCostLineInput,
} from "@/lib/change-orders/cost-lines"
import {
  allowedChangeOrderTransitions,
  canEditChangeOrderContent,
  canTransitionChangeOrder,
  isChangeOrderStatus,
  isExternallyPublishedChangeOrderStatus,
  type ChangeOrderStatus,
} from "@/lib/change-orders/status"
import {
  canViewChangeOrder,
  changeOrderRequesterType,
  type ChangeOrderRequesterType,
} from "@/lib/change-orders/access"
import { getCloudflareContext } from "@/lib/db"
import {
  preflightProjectContractBudget,
  rebuildProjectContractBudget,
} from "@/lib/financials/contract-budget-store"
import {
  isEstimateAcceptanceMethod,
  type EstimateAcceptanceMethod,
} from "@/lib/financials/estimate-ledger"
import {
  canFeature,
  requireFeaturePermission,
} from "@/lib/permission-enforcement"
import { assertProjectAccess } from "@/lib/project-access"
import type { ProjectAudience } from "@/lib/project-audience-access"
import { isInternalStaffRole } from "@/lib/user-roles"

export type ChangeOrderAudience = "internal" | "owner" | "sub_vendor"
export type ChangeOrderDocumentInput = {
  readonly label: string
  readonly url: string
  readonly notes: string | null
}

export type ProjectChangeOrderPhaseOption = {
  readonly value: string
  readonly label: string
}

export type ProjectChangeOrderCostCodeOption = {
  readonly value: string
  readonly label: string
  readonly description: string
  readonly divisionCode: string
}

export type ProjectChangeOrderCompanyOption = {
  readonly value: string
  readonly label: string
  readonly description: string
}

export type ProjectChangeOrderFormOptions = {
  readonly phases: readonly ProjectChangeOrderPhaseOption[]
  readonly costCodes: readonly ProjectChangeOrderCostCodeOption[]
  readonly companies: readonly ProjectChangeOrderCompanyOption[]
}

export type ProjectChangeOrderItem = {
  readonly id: string
  readonly projectId: string
  readonly changeOrderNumber: string
  readonly title: string
  readonly scope: string
  readonly reason: string | null
  readonly amountCents: number | null
  readonly scheduleImpactDays: number | null
  readonly status: ChangeOrderStatus
  readonly audience: ChangeOrderAudience
  readonly requesterType: ChangeOrderRequesterType
  readonly requesterUserId: string | null
  readonly requesterName: string
  readonly requesterCompany: string | null
  readonly sourceType: string
  readonly sourceRecordId: string | null
  readonly sourceHref: string | null
  readonly internalNotes: string | null
  readonly foxitStatus: string
  readonly acceptanceMethod: string | null
  readonly acceptanceEvidenceUrl: string | null
  readonly acceptanceEvidenceLabel: string | null
  readonly acceptanceNote: string | null
  readonly acceptanceRecordedByName: string | null
  readonly executedAt: string | null
  readonly sageStatus: string
  readonly submittedAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
  readonly canEdit: boolean
  readonly canApprove: boolean
  readonly allowedTransitions: readonly ChangeOrderStatus[]
  readonly lines: readonly {
    readonly id: string
    readonly lineNumber: number
    readonly description: string
    readonly phaseCode: string | null
    readonly costCode: string | null
    readonly amountCents: number | null
  }[]
  readonly documents: readonly {
    readonly id: string
    readonly label: string
    readonly url: string
    readonly notes: string | null
  }[]
  readonly history: readonly {
    readonly id: string
    readonly eventType: string
    readonly fromStatus: string | null
    readonly toStatus: string | null
    readonly actorName: string
    readonly actorRole: string
    readonly note: string | null
    readonly createdAt: string
  }[]
}

export type CreateProjectChangeOrderInput = {
  readonly title: string
  readonly scope: string
  readonly reason: string | null
  readonly scheduleImpactDays: number | null
  readonly lines: readonly ChangeOrderCostLineInput[]
  readonly audience: ChangeOrderAudience
  readonly requesterCompany: string | null
  readonly sourceRecordId: string | null
  readonly sourceHref: string | null
  readonly initialStatus: "draft" | "submitted"
  readonly documents: readonly ChangeOrderDocumentInput[]
}

export type UpdateProjectChangeOrderInput = {
  readonly title: string
  readonly scope: string
  readonly reason: string | null
  readonly scheduleImpactDays: number | null
  readonly lines: readonly ChangeOrderCostLineInput[]
  readonly audience: ChangeOrderAudience
  readonly internalNotes: string | null
  readonly status: ChangeOrderStatus
  readonly transitionNote: string | null
  readonly documents: readonly ChangeOrderDocumentInput[]
}

export type ChangeOrderManualAcceptanceInput = {
  readonly acceptanceMethod: string | null
  readonly ownerApprovedAt: string | null
  readonly evidenceUrl: string | null
  readonly evidenceLabel: string | null
  readonly acceptanceNote: string | null
  readonly attested: boolean
}

type ChangeOrderContext = {
  readonly db: ReturnType<typeof getDb>
  readonly user: AuthUser
  readonly projectNumber: string | null
  readonly projectRole: string | null
  readonly internal: boolean
  readonly canUpdate: boolean
  readonly canApprove: boolean
  readonly requesterType: ChangeOrderRequesterType | null
}

type ChangeOrderActionResult =
  | { readonly success: true; readonly id: string }
  | { readonly success: false; readonly error: string }

type ChangeOrderUploadSessionResult =
  | { readonly success: true; readonly uploadUrl: string }
  | { readonly success: false; readonly error: string }

function cleanText(value: string | null): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed.length > 0 ? trimmed : null
}

function requireText(value: string, label: string, maxLength = 10_000): string {
  const cleaned = cleanText(value)
  if (!cleaned) throw new Error(`${label} is required`)
  if (cleaned.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer`)
  }
  return cleaned
}

function cleanLimitedText(
  value: string | null,
  label: string,
  maxLength: number
): string | null {
  const cleaned = cleanText(value)
  if (!cleaned) return null
  if (cleaned.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer`)
  }
  return cleaned
}

function requiredLimitedText(
  value: string | null,
  label: string,
  maxLength: number
): string {
  const cleaned = cleanLimitedText(value, label, maxLength)
  if (!cleaned) throw new Error(`${label} is required`)
  return cleaned
}

function ownerApprovalDate(value: string | null): string {
  const cleaned = requiredLimitedText(value, "Owner approval date", 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    throw new Error("Owner approval date must be a valid date")
  }
  const parsed = new Date(`${cleaned}T00:00:00.000Z`)
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== cleaned
  ) {
    throw new Error("Owner approval date must be a valid date")
  }
  const tomorrow = new Date()
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  if (parsed >= tomorrow) {
    throw new Error("Owner approval date cannot be in the future")
  }
  return cleaned
}

function safeAcceptanceEvidenceUrl(value: string | null): string {
  const url = safeDocumentUrl(
    requiredLimitedText(value, "Approval evidence", 2_048)
  )
  if (new URL(url).protocol !== "https:") {
    throw new Error("Approval evidence links must use HTTPS")
  }
  return url
}

function acceptanceMethodLabel(method: EstimateAcceptanceMethod): string {
  const labels: Readonly<Record<EstimateAcceptanceMethod, string>> = {
    foxit: "Foxit signature",
    wet_signature: "Wet-signed document",
    external_esignature: "External e-signature",
    written_owner_approval: "Written owner approval",
    historical_executed_contract: "Historical executed contract",
  }
  return labels[method]
}

function validAudience(value: string): value is ChangeOrderAudience {
  return ["internal", "owner", "sub_vendor"].includes(value)
}

function safeDocumentUrl(value: string): string {
  const cleaned = requireText(value, "Document URL", 2_048)
  const parsed = new URL(cleaned)
  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new Error("Document links must use HTTP or HTTPS")
  }
  return parsed.toString()
}

function cleanDocuments(
  documents: readonly ChangeOrderDocumentInput[]
): readonly ChangeOrderDocumentInput[] {
  if (documents.length > 20) {
    throw new Error("A change order can have at most 20 supporting documents")
  }
  return documents
    .filter((document) => cleanText(document.url) !== null)
    .map((document) => ({
      label: document.label.trim()
        ? requireText(document.label, "Document label", 200)
        : "Supporting document",
      url: safeDocumentUrl(document.url),
      notes: cleanLimitedText(document.notes, "Document notes", 1_000),
    }))
}

async function changeOrderContext(
  projectId: string,
  action: "create" | "read" | "update"
): Promise<ChangeOrderContext> {
  const user = await requireAuth()
  await requireFeaturePermission(user, "change-orders", action)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const project = await assertProjectAccess(db, user, projectId)
  const membership = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, user.id)
      )
    )
    .get()
  const internal = isInternalStaffRole(user.role)
  const projectRole = membership?.role ?? null
  const canApprove =
    internal && (await canFeature(user, "change-orders", "approve"))
  const canUpdate =
    internal && (await canFeature(user, "change-orders", "update"))

  return {
    db,
    user,
    projectNumber: project.projectNumber,
    projectRole,
    internal,
    canUpdate,
    canApprove,
    requesterType: changeOrderRequesterType({ internal, projectRole }),
  }
}

function canExternalViewerSee(
  row: typeof projectChangeOrders.$inferSelect,
  context: ChangeOrderContext
): boolean {
  if (!isChangeOrderStatus(row.status)) return false
  return canViewChangeOrder({
    internal: context.internal,
    viewerId: context.user.id,
    viewerRequesterType: context.requesterType,
    requesterUserId: row.requesterUserId,
    audience: row.audience,
    status: row.status,
  })
}

function audiencePreviewContext(
  context: ChangeOrderContext,
  audience: ProjectAudience | undefined
): ChangeOrderContext {
  if (!context.internal || !audience) return context
  return {
    ...context,
    internal: false,
    canUpdate: false,
    canApprove: false,
    requesterType: audience === "owner" ? "owner" : "subcontractor",
  }
}

function revalidateChangeOrderPaths(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}`)
  revalidatePath(`/dashboard/projects/${projectId}/change-orders`)
  revalidatePath(`/preview/projects/${projectId}/owner/change-orders`)
  revalidatePath(`/preview/projects/${projectId}/sub-vendor/change-orders`)
}

function changeOrderNumber(
  projectNumber: string | null,
  count: number
): string {
  const prefix = cleanText(projectNumber) ?? "PROJECT"
  return `${prefix}-CO-${String(count + 1).padStart(3, "0")}`
}

function actorName(user: AuthUser): string {
  return user.displayName ?? user.email
}

function viewModel(
  row: typeof projectChangeOrders.$inferSelect,
  context: ChangeOrderContext,
  lines: ProjectChangeOrderItem["lines"],
  documents: ProjectChangeOrderItem["documents"],
  history: ProjectChangeOrderItem["history"]
): ProjectChangeOrderItem | null {
  if (
    !isChangeOrderStatus(row.status) ||
    !validAudience(row.audience) ||
    !["internal", "owner", "subcontractor"].includes(row.requesterType)
  ) {
    return null
  }
  const requesterType =
    row.requesterType === "owner"
      ? "owner"
      : row.requesterType === "subcontractor"
        ? "subcontractor"
        : "internal"
  const status = row.status
  const isRequester = row.requesterUserId === context.user.id
  const canApprove = context.canApprove
  const canEdit =
    (!context.internal || context.canUpdate) &&
    canEditChangeOrderContent({
      status,
      internal: context.internal,
      isRequester,
    })
  const transitions =
    context.internal && !context.canUpdate
      ? []
      : allowedChangeOrderTransitions(status).filter((to) =>
          canTransitionChangeOrder({
            from: status,
            to,
            internal: context.internal,
            canApprove,
          })
        )

  return {
    id: row.id,
    projectId: row.projectId,
    changeOrderNumber: row.changeOrderNumber,
    title: row.title,
    scope: row.scope,
    reason: row.reason,
    amountCents: row.amountCents,
    scheduleImpactDays: row.scheduleImpactDays,
    status,
    audience: row.audience,
    requesterType,
    requesterUserId: row.requesterUserId,
    requesterName: row.requesterName,
    requesterCompany: row.requesterCompany,
    sourceType: row.sourceType,
    sourceRecordId: context.internal ? row.sourceRecordId : null,
    sourceHref: context.internal ? row.sourceHref : null,
    internalNotes: context.internal ? row.internalNotes : null,
    foxitStatus: row.foxitStatus,
    acceptanceMethod: row.acceptanceMethod,
    acceptanceEvidenceUrl: row.acceptanceEvidenceUrl,
    acceptanceEvidenceLabel: row.acceptanceEvidenceLabel,
    acceptanceNote: context.internal ? row.acceptanceNote : null,
    acceptanceRecordedByName: row.acceptanceRecordedByName,
    executedAt: row.executedAt,
    sageStatus: row.sageStatus,
    submittedAt: row.submittedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    canEdit,
    canApprove,
    allowedTransitions: transitions.filter(
      (status) => status !== "synced" && status !== "executed"
    ),
    lines,
    documents,
    history,
  }
}

export async function getProjectChangeOrders(
  projectId: string,
  viewAsAudience?: ProjectAudience
): Promise<readonly ProjectChangeOrderItem[]> {
  const authorizedContext = await changeOrderContext(projectId, "read")
  const context = audiencePreviewContext(authorizedContext, viewAsAudience)
  const rows = await authorizedContext.db
    .select()
    .from(projectChangeOrders)
    .where(eq(projectChangeOrders.projectId, projectId))
    .orderBy(desc(projectChangeOrders.updatedAt))

  return rows
    .filter((row) => canExternalViewerSee(row, context))
    .map((row) => viewModel(row, context, [], [], []))
    .filter((row): row is ProjectChangeOrderItem => row !== null)
}

export async function getProjectChangeOrderCapabilities(
  projectId: string
): Promise<{
  readonly canCreate: boolean
  readonly requesterType: ChangeOrderRequesterType | null
}> {
  const context = await changeOrderContext(projectId, "read")
  const createAllowed = await canFeature(
    context.user,
    "change-orders",
    "create"
  )
  return {
    canCreate: createAllowed && context.requesterType !== null,
    requesterType: context.requesterType,
  }
}

export async function getProjectChangeOrderUploadSessionUrl(
  projectId: string,
  fileName: string,
  mimeType: string
): Promise<ChangeOrderUploadSessionResult> {
  try {
    const context = await changeOrderContext(projectId, "create")
    const project = await context.db
      .select({ googleDriveFolderId: projects.googleDriveFolderId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .get()
    return await getUploadSessionUrl(
      fileName,
      mimeType,
      project?.googleDriveFolderId ?? undefined
    )
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not start the document upload.",
    }
  }
}

export async function getProjectChangeOrderFormOptions(
  projectId: string,
  viewAsAudience?: ProjectAudience
): Promise<ProjectChangeOrderFormOptions> {
  const authorizedContext = await changeOrderContext(projectId, "read")
  const context = audiencePreviewContext(authorizedContext, viewAsAudience)
  if (!context.internal) {
    return { phases: [], costCodes: [], companies: [] }
  }
  const [sageRows, budgetRows, contactRows] = await Promise.all([
    context.db
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
    context.db
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
    context.db
      .select({
        displayName: projectContacts.displayName,
        companyName: projectContacts.companyName,
        contactType: projectContacts.contactType,
      })
      .from(projectContacts)
      .where(
        and(
          eq(projectContacts.projectId, projectId),
          eq(projectContacts.active, true)
        )
      )
      .orderBy(asc(projectContacts.companyName), asc(projectContacts.displayName)),
  ])
  const phaseMap = new Map<string, ProjectChangeOrderPhaseOption>()
  const costCodeMap = new Map<string, ProjectChangeOrderCostCodeOption>()
  const companyMap = new Map<string, ProjectChangeOrderCompanyOption>()

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
  for (const row of contactRows) {
    const value = cleanText(row.companyName) ?? cleanText(row.displayName)
    if (!value || companyMap.has(value.toLowerCase())) continue
    companyMap.set(value.toLowerCase(), {
      value,
      label: value,
      description: `${row.contactType} · ${row.displayName}`,
    })
  }

  return {
    phases: Array.from(phaseMap.values()).sort((left, right) =>
      left.label.localeCompare(right.label)
    ),
    costCodes: Array.from(costCodeMap.values()).sort((left, right) =>
      left.label.localeCompare(right.label)
    ),
    companies: Array.from(companyMap.values()).sort((left, right) =>
      left.label.localeCompare(right.label)
    ),
  }
}

export async function getProjectChangeOrder(
  projectId: string,
  changeOrderId: string,
  viewAsAudience?: ProjectAudience
): Promise<ProjectChangeOrderItem | null> {
  const authorizedContext = await changeOrderContext(projectId, "read")
  const context = audiencePreviewContext(authorizedContext, viewAsAudience)
  const row = await authorizedContext.db
    .select()
    .from(projectChangeOrders)
    .where(
      and(
        eq(projectChangeOrders.id, changeOrderId),
        eq(projectChangeOrders.projectId, projectId)
      )
    )
    .get()
  if (!row || !canExternalViewerSee(row, context)) return null

  const [lineRows, documentRows, historyRows] = await Promise.all([
    authorizedContext.db
      .select({
        id: projectChangeOrderLines.id,
        lineNumber: projectChangeOrderLines.lineNumber,
        description: projectChangeOrderLines.description,
        phaseCode: projectChangeOrderLines.phaseCode,
        costCode: projectChangeOrderLines.costCode,
        amountCents: projectChangeOrderLines.amountCents,
      })
      .from(projectChangeOrderLines)
      .where(eq(projectChangeOrderLines.changeOrderId, changeOrderId))
      .orderBy(asc(projectChangeOrderLines.lineNumber)),
    authorizedContext.db
      .select({
        id: projectChangeOrderDocuments.id,
        label: projectChangeOrderDocuments.label,
        url: projectChangeOrderDocuments.url,
        notes: projectChangeOrderDocuments.notes,
      })
      .from(projectChangeOrderDocuments)
      .where(eq(projectChangeOrderDocuments.changeOrderId, changeOrderId))
      .orderBy(asc(projectChangeOrderDocuments.createdAt)),
    authorizedContext.db
      .select({
        id: projectChangeOrderHistory.id,
        eventType: projectChangeOrderHistory.eventType,
        fromStatus: projectChangeOrderHistory.fromStatus,
        toStatus: projectChangeOrderHistory.toStatus,
        actorName: projectChangeOrderHistory.actorName,
        actorRole: projectChangeOrderHistory.actorRole,
        actorUserId: projectChangeOrderHistory.actorUserId,
        note: projectChangeOrderHistory.note,
        createdAt: projectChangeOrderHistory.createdAt,
      })
      .from(projectChangeOrderHistory)
      .where(eq(projectChangeOrderHistory.changeOrderId, changeOrderId))
      .orderBy(desc(projectChangeOrderHistory.createdAt)),
  ])

  const visibleHistory = context.internal
    ? historyRows
    : historyRows
        .filter((event) => {
          if (row.requesterUserId === context.user.id) return true
          return (
            event.toStatus !== null &&
            isChangeOrderStatus(event.toStatus) &&
            isExternallyPublishedChangeOrderStatus(event.toStatus)
          )
        })
        .map((event) => ({
          ...event,
          // Transition notes are internal by default. External requesters see
          // their own notes plus explicit requests for more information.
          note:
            event.actorUserId === context.user.id ||
            event.toStatus === "needs_information"
              ? event.note
              : null,
        }))

  return viewModel(row, context, lineRows, documentRows, visibleHistory)
}

export async function createProjectChangeOrder(
  projectId: string,
  input: CreateProjectChangeOrderInput
): Promise<ChangeOrderActionResult> {
  try {
    const context = await changeOrderContext(projectId, "create")
    if (!context.requesterType) {
      return {
        success: false,
        error: "Only internal staff, owners, and subcontractors can request changes.",
      }
    }
    const existing = await context.db
      .select({ id: projectChangeOrders.id })
      .from(projectChangeOrders)
      .where(eq(projectChangeOrders.projectId, projectId))
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const internal = context.internal
    const requestedInitialStatus =
      input.initialStatus === "submitted" ? "submitted" : "draft"
    const status: ChangeOrderStatus = internal
      ? requestedInitialStatus
      : "submitted"
    const audience: ChangeOrderAudience = internal
      ? input.audience
      : context.requesterType === "owner"
        ? "owner"
        : "sub_vendor"
    if (!validAudience(audience)) {
      return { success: false, error: "Choose a valid audience." }
    }
    const documents = cleanDocuments(input.documents)
    const lines = cleanChangeOrderCostLines(input.lines)
    const amountCents = changeOrderCostLinesTotalCents(lines)
    const scheduleImpactDays = cleanScheduleImpactDays(
      input.scheduleImpactDays
    )
    const sourceType =
      context.requesterType === "owner"
        ? "owner_request"
        : context.requesterType === "subcontractor"
          ? "subcontractor_request"
          : "internal_request"
    const row: typeof projectChangeOrders.$inferInsert = {
      id,
      projectId,
      changeOrderNumber: changeOrderNumber(
        context.projectNumber,
        existing.length
      ),
      title: requireText(input.title, "Title", 200),
      scope: requireText(input.scope, "Scope", 10_000),
      reason: cleanLimitedText(input.reason, "Reason", 4_000),
      amountCents,
      scheduleImpactDays,
      status,
      audience,
      requesterType: context.requesterType,
      requesterUserId: context.user.id,
      requesterName: actorName(context.user),
      requesterCompany: input.requesterCompany
        ? requireText(input.requesterCompany, "Company", 200)
        : null,
      sourceType,
      sourceRecordId: cleanText(input.sourceRecordId),
      sourceHref: input.sourceHref ? safeDocumentUrl(input.sourceHref) : null,
      internalNotes: null,
      foxitStatus: "not_started",
      sageStatus: "not_ready",
      createdBy: context.user.id,
      submittedAt: status === "submitted" ? now : null,
      createdAt: now,
      updatedAt: now,
    }
    const documentRows = documents.map((document) => ({
      id: crypto.randomUUID(),
      projectId,
      changeOrderId: id,
      label: document.label,
      url: document.url,
      notes: document.notes,
      createdBy: context.user.id,
      createdAt: now,
    }))
    const lineRows = lines.map((line) => ({
      id: crypto.randomUUID(),
      projectId,
      changeOrderId: id,
      lineNumber: line.lineNumber,
      description: line.description,
      phaseCode: line.phaseCode,
      costCode: line.costCode,
      amountCents: line.amountCents,
      createdAt: now,
      updatedAt: now,
    }))
    const historyRow = {
      id: crypto.randomUUID(),
      projectId,
      changeOrderId: id,
      eventType: "created",
      fromStatus: null,
      toStatus: status,
      actorUserId: context.user.id,
      actorName: actorName(context.user),
      actorRole: context.user.role,
      note: null,
      metadataJson: JSON.stringify({
        audience,
        sourceType,
        lineCount: lineRows.length,
        scheduleImpactDays,
      }),
      createdAt: now,
    }

    if (documentRows.length > 0 && lineRows.length > 0) {
      await context.db.batch([
        context.db.insert(projectChangeOrders).values(row),
        context.db.insert(projectChangeOrderLines).values(lineRows),
        context.db.insert(projectChangeOrderDocuments).values(documentRows),
        context.db.insert(projectChangeOrderHistory).values(historyRow),
      ])
    } else if (lineRows.length > 0) {
      await context.db.batch([
        context.db.insert(projectChangeOrders).values(row),
        context.db.insert(projectChangeOrderLines).values(lineRows),
        context.db.insert(projectChangeOrderHistory).values(historyRow),
      ])
    } else if (documentRows.length > 0) {
      await context.db.batch([
        context.db.insert(projectChangeOrders).values(row),
        context.db.insert(projectChangeOrderDocuments).values(documentRows),
        context.db.insert(projectChangeOrderHistory).values(historyRow),
      ])
    } else {
      await context.db.batch([
        context.db.insert(projectChangeOrders).values(row),
        context.db.insert(projectChangeOrderHistory).values(historyRow),
      ])
    }
    revalidateChangeOrderPaths(projectId)
    return { success: true, id }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to create change order request",
    }
  }
}

export async function updateProjectChangeOrder(
  projectId: string,
  changeOrderId: string,
  input: UpdateProjectChangeOrderInput
): Promise<ChangeOrderActionResult> {
  try {
    const context = await changeOrderContext(projectId, "read")
    if (context.internal) {
      await requireFeaturePermission(context.user, "change-orders", "update")
    }
    const existing = await context.db
      .select()
      .from(projectChangeOrders)
      .where(
        and(
          eq(projectChangeOrders.id, changeOrderId),
          eq(projectChangeOrders.projectId, projectId)
        )
      )
      .get()
    if (
      !existing ||
      !canExternalViewerSee(existing, context) ||
      !isChangeOrderStatus(existing.status)
    ) {
      return { success: false, error: "Change order request not found." }
    }
    const isRequester = existing.requesterUserId === context.user.id
    const contentAllowed = canEditChangeOrderContent({
      status: existing.status,
      internal: context.internal,
      isRequester,
    })
    if (!isChangeOrderStatus(input.status)) {
      return { success: false, error: "Choose a valid status." }
    }
    const statusChanged = input.status !== existing.status
    const canApprove = context.canApprove
    if (
      statusChanged &&
      !canTransitionChangeOrder({
        from: existing.status,
        to: input.status,
        internal: context.internal,
        canApprove,
      })
    ) {
      return { success: false, error: "That status transition is not allowed." }
    }
    if (statusChanged && input.status === "executed") {
      return {
        success: false,
        error:
          "Record the owner's approval and supporting evidence before executing this change order.",
      }
    }
    if (input.status === "synced") {
      return {
        success: false,
        error: "Sage sync must be completed by the future approved connector.",
      }
    }
    const audience = context.internal ? input.audience : existing.audience
    if (!validAudience(audience)) {
      return { success: false, error: "Choose a valid audience." }
    }
    const now = new Date().toISOString()
    const documents = contentAllowed ? cleanDocuments(input.documents) : null
    const lines = contentAllowed ? cleanChangeOrderCostLines(input.lines) : null
    const title = contentAllowed
      ? requireText(input.title, "Title", 200)
      : existing.title
    const scope = contentAllowed
      ? requireText(input.scope, "Scope", 10_000)
      : existing.scope
    const reason = contentAllowed
      ? cleanLimitedText(input.reason, "Reason", 4_000)
      : existing.reason
    const amountCents = lines
      ? changeOrderCostLinesTotalCents(lines)
      : existing.amountCents
    const scheduleImpactDays = contentAllowed
      ? cleanScheduleImpactDays(input.scheduleImpactDays)
      : existing.scheduleImpactDays
    if (input.status === "executed") {
      const executionLines =
        lines ??
        (await context.db
          .select({
            costCode: projectChangeOrderLines.costCode,
            amountCents: projectChangeOrderLines.amountCents,
          })
          .from(projectChangeOrderLines)
          .where(
            and(
              eq(projectChangeOrderLines.changeOrderId, changeOrderId),
              eq(projectChangeOrderLines.projectId, projectId)
            )
          ))
      if (executionLines.length === 0) {
        return {
          success: false,
          error: "Add at least one cost-coded line before execution.",
        }
      }
      if (
        executionLines.some(
          (line) => !line.costCode || line.amountCents === null
        )
      ) {
        return {
          success: false,
          error:
            "Every executed change-order line needs a cost code and amount so it can revise the G703.",
        }
      }
    }
    const updateStatement = context.db
      .update(projectChangeOrders)
      .set({
        title,
        scope,
        reason,
        amountCents,
        scheduleImpactDays,
        audience: contentAllowed ? audience : existing.audience,
        internalNotes: context.internal
          ? cleanLimitedText(input.internalNotes, "Internal notes", 4_000)
          : existing.internalNotes,
        status: input.status,
        submittedAt:
          input.status === "submitted"
            ? existing.submittedAt ?? now
            : existing.submittedAt,
        foxitStatus:
          input.status === "signature_pending"
            ? "handoff_ready"
            : existing.foxitStatus,
        executedAt:
          input.status === "executed" ? existing.executedAt ?? now : existing.executedAt,
        sageStatus:
          input.status === "sage_pending"
            ? "pending_manual_sync"
            : existing.sageStatus,
        updatedAt: now,
      })
      .where(
        and(
          eq(projectChangeOrders.id, changeOrderId),
          eq(projectChangeOrders.projectId, projectId)
        )
      )
    const historyStatement = context.db
      .insert(projectChangeOrderHistory)
      .values({
        id: crypto.randomUUID(),
        projectId,
        changeOrderId,
        eventType: statusChanged ? "status_transition" : "updated",
        fromStatus: existing.status,
        toStatus: input.status,
        actorUserId: context.user.id,
        actorName: actorName(context.user),
        actorRole: context.user.role,
        note: cleanLimitedText(
          input.transitionNote,
          "Transition note",
          2_000
        ),
        metadataJson: JSON.stringify({
          audience: contentAllowed ? audience : existing.audience,
          documentCount: documents?.length ?? null,
          lineCount: lines?.length ?? null,
          scheduleImpactDays,
        }),
        createdAt: now,
      })
    if (documents === null || lines === null) {
      await context.db.batch([updateStatement, historyStatement])
    } else {
      const deleteDocumentsStatement = context.db
        .delete(projectChangeOrderDocuments)
        .where(
          and(
            eq(projectChangeOrderDocuments.changeOrderId, changeOrderId),
            eq(projectChangeOrderDocuments.projectId, projectId)
          )
        )
      const deleteLinesStatement = context.db
        .delete(projectChangeOrderLines)
        .where(
          and(
            eq(projectChangeOrderLines.changeOrderId, changeOrderId),
            eq(projectChangeOrderLines.projectId, projectId)
          )
        )
      const lineRows = lines.map((line) => ({
        id: crypto.randomUUID(),
        projectId,
        changeOrderId,
        lineNumber: line.lineNumber,
        description: line.description,
        phaseCode: line.phaseCode,
        costCode: line.costCode,
        amountCents: line.amountCents,
        createdAt: now,
        updatedAt: now,
      }))
      const documentRows = documents.map((document) => ({
        id: crypto.randomUUID(),
        projectId,
        changeOrderId,
        label: document.label,
        url: document.url,
        notes: document.notes,
        createdBy: context.user.id,
        createdAt: now,
      }))
      if (documentRows.length === 0 && lineRows.length === 0) {
        await context.db.batch([
          updateStatement,
          deleteDocumentsStatement,
          deleteLinesStatement,
          historyStatement,
        ])
      } else if (documentRows.length > 0 && lineRows.length > 0) {
        await context.db.batch([
          updateStatement,
          deleteDocumentsStatement,
          context.db.insert(projectChangeOrderDocuments).values(documentRows),
          deleteLinesStatement,
          context.db.insert(projectChangeOrderLines).values(lineRows),
          historyStatement,
        ])
      } else if (documentRows.length > 0) {
        const insertDocumentsStatement = context.db
          .insert(projectChangeOrderDocuments)
          .values(documentRows)
        await context.db.batch([
          updateStatement,
          deleteDocumentsStatement,
          insertDocumentsStatement,
          deleteLinesStatement,
          historyStatement,
        ])
      } else {
        await context.db.batch([
          updateStatement,
          deleteDocumentsStatement,
          deleteLinesStatement,
          context.db.insert(projectChangeOrderLines).values(lineRows),
          historyStatement,
        ])
      }
    }
    if (statusChanged && input.status === "executed") {
      await rebuildProjectContractBudget({
        db: context.db,
        projectId,
        actorUserId: context.user.id,
      })
    }
    revalidateChangeOrderPaths(projectId)
    return { success: true, id: changeOrderId }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to update change order request",
    }
  }
}

export async function recordManualProjectChangeOrderAcceptance(
  projectId: string,
  changeOrderId: string,
  input: ChangeOrderManualAcceptanceInput
): Promise<ChangeOrderActionResult> {
  try {
    const context = await changeOrderContext(projectId, "update")
    if (!context.internal || !context.canApprove) {
      return {
        success: false,
        error: "Change-order approval permission is required.",
      }
    }
    const existing = await context.db
      .select()
      .from(projectChangeOrders)
      .where(
        and(
          eq(projectChangeOrders.id, changeOrderId),
          eq(projectChangeOrders.projectId, projectId)
        )
      )
      .get()
    if (
      !existing ||
      !["approved_for_owner", "signature_pending"].includes(existing.status)
    ) {
      return {
        success: false,
        error:
          "Move the change order to Approved for Owner or Signature Pending before recording acceptance.",
      }
    }
    if (!input.attested) {
      return {
        success: false,
        error:
          "Confirm that the evidence reflects the owner's approval of this change order.",
      }
    }
    if (
      !isEstimateAcceptanceMethod(input.acceptanceMethod) ||
      input.acceptanceMethod === "foxit"
    ) {
      return { success: false, error: "Choose how the owner approved it." }
    }

    const approvalDate = ownerApprovalDate(input.ownerApprovedAt)
    const evidenceUrl = safeAcceptanceEvidenceUrl(input.evidenceUrl)
    const evidenceLabel = requiredLimitedText(
      input.evidenceLabel,
      "Evidence label",
      200
    )
    const acceptanceNote = requiredLimitedText(
      input.acceptanceNote,
      "Acceptance note",
      2_000
    )

    const lines = await context.db
      .select({
        costCode: projectChangeOrderLines.costCode,
        amountCents: projectChangeOrderLines.amountCents,
      })
      .from(projectChangeOrderLines)
      .where(
        and(
          eq(projectChangeOrderLines.changeOrderId, changeOrderId),
          eq(projectChangeOrderLines.projectId, projectId)
        )
      )
    if (lines.length === 0) {
      return {
        success: false,
        error: "Add at least one cost-coded line before acceptance.",
      }
    }
    if (lines.some((line) => !line.costCode || line.amountCents === null)) {
      return {
        success: false,
        error:
          "Every accepted change-order line needs a cost code and amount so it can revise the G703.",
      }
    }

    const acceptedEstimates = await context.db
      .select({ id: projectEstimates.id })
      .from(projectEstimates)
      .where(
        and(
          eq(projectEstimates.projectId, projectId),
          eq(projectEstimates.status, "accepted")
        )
      )
      .orderBy(desc(projectEstimates.versionNumber))
      .limit(1)
    const acceptedEstimate = acceptedEstimates[0]
    if (!acceptedEstimate) {
      return {
        success: false,
        error:
          "Accept the project's original estimate before executing a change order.",
      }
    }
    const preflight = await preflightProjectContractBudget({
      db: context.db,
      projectId,
      estimateId: acceptedEstimate.id,
    })
    if (!preflight.success) {
      return {
        success: false,
        error: `Resolve the contract budget before acceptance: ${preflight.error}`,
      }
    }

    const costCodes = [
      ...new Set(
        lines
          .map((line) => line.costCode)
          .filter((code): code is string => code !== null)
      ),
    ]
    const activeCodeRows = costCodes.length > 0
      ? await context.db
          .select({ code: sageCostCodes.code })
          .from(sageCostCodes)
          .where(
            and(
              eq(sageCostCodes.active, true),
              inArray(sageCostCodes.code, costCodes)
            )
          )
      : []
    const activeCodes = new Set(activeCodeRows.map((row) => row.code))
    const missingCostCodeCount = costCodes.filter(
      (code) => !activeCodes.has(code)
    ).length
    const now = new Date().toISOString()
    const executedAt = `${approvalDate}T12:00:00.000Z`
    const acceptanceRecordedByName = actorName(context.user)
    const existingDocuments = await context.db
      .select({
        id: projectChangeOrderDocuments.id,
        url: projectChangeOrderDocuments.url,
      })
      .from(projectChangeOrderDocuments)
      .where(
        eq(projectChangeOrderDocuments.changeOrderId, changeOrderId)
      )
    const matchingEvidence = existingDocuments.find(
      (document) => document.url === evidenceUrl
    )
    if (!matchingEvidence && existingDocuments.length >= 20) {
      return {
        success: false,
        error:
          "Remove a supporting document before adding owner-acceptance evidence.",
      }
    }

    const updateStatement = context.db
      .update(projectChangeOrders)
      .set({
        status: "executed",
        executedAt,
        foxitStatus: "not_applicable",
        acceptanceMethod: input.acceptanceMethod,
        acceptanceEvidenceUrl: evidenceUrl,
        acceptanceEvidenceLabel: evidenceLabel,
        acceptanceNote,
        acceptanceRecordedByName,
        sageStatus:
          missingCostCodeCount > 0 ? "mapping_required" : "ready",
        updatedAt: now,
      })
      .where(
        and(
          eq(projectChangeOrders.id, changeOrderId),
          eq(projectChangeOrders.projectId, projectId)
        )
      )
    const historyStatement = context.db
      .insert(projectChangeOrderHistory)
      .values({
        id: crypto.randomUUID(),
        projectId,
        changeOrderId,
        eventType: "manual_owner_acceptance",
        fromStatus: existing.status,
        toStatus: "executed",
        actorUserId: context.user.id,
        actorName: acceptanceRecordedByName,
        actorRole: context.user.role,
        note: acceptanceNote,
        metadataJson: JSON.stringify({
          acceptanceMethod: input.acceptanceMethod,
          approvalDate,
          evidenceLabel,
          amountCents: existing.amountCents,
          missingSageMappingCount: missingCostCodeCount,
        }),
        createdAt: now,
      })
    if (matchingEvidence) {
      await context.db.batch([updateStatement, historyStatement])
    } else {
      await context.db.batch([
        updateStatement,
        context.db.insert(projectChangeOrderDocuments).values({
          id: crypto.randomUUID(),
          projectId,
          changeOrderId,
          label: evidenceLabel,
          url: evidenceUrl,
          notes: `Owner acceptance evidence · ${acceptanceMethodLabel(input.acceptanceMethod)}`,
          createdBy: context.user.id,
          createdAt: now,
        }),
        historyStatement,
      ])
    }

    const budget = await rebuildProjectContractBudget({
      db: context.db,
      projectId,
      actorUserId: context.user.id,
    })
    if (!budget.success) {
      return {
        success: false,
        error: `Change order accepted, but the G703 needs review: ${budget.error}`,
      }
    }
    revalidateChangeOrderPaths(projectId)
    return { success: true, id: changeOrderId }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to record change-order acceptance",
    }
  }
}
