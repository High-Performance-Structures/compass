"use server"

import { and, asc, desc, eq, inArray, isNull, ne, or } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getUploadSessionUrl } from "@/app/actions/google-drive"
import { getDb } from "@/db"
import {
  projectBudgetLines,
  projectBudgetApplications,
  projectChangeOrderDocuments,
  projectChangeOrderHistory,
  projectChangeOrderLines,
  projectChangeOrders,
  projectContacts,
  projectMembers,
  projectOperations,
  projects,
  sageCostCodes,
} from "@/db/schema"
import { invoices, payments, vendorBills } from "@/db/schema-netsuite"
import {
  projectContractBudgetRevisions,
  projectEstimateLines,
  projectEstimates,
} from "@/db/schema-estimates"
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
import { rebuildProjectContractBudget } from "@/lib/financials/contract-budget-store"
import {
  isChangeOrderBudgetTreatment,
  preconstructionRebaselineBlockers,
  rebaselineEstimateDocumentLinks,
  type ChangeOrderBudgetTreatment,
} from "@/lib/change-orders/rebaseline"
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

export type ProjectChangeOrderEstimateOption = {
  readonly id: string
  readonly estimateNumber: string
  readonly versionNumber: number
  readonly title: string
  readonly status: string
  readonly estimateTotalCents: number
}

export type ProjectChangeOrderFormOptions = {
  readonly phases: readonly ProjectChangeOrderPhaseOption[]
  readonly costCodes: readonly ProjectChangeOrderCostCodeOption[]
  readonly companies: readonly ProjectChangeOrderCompanyOption[]
  readonly estimates: readonly ProjectChangeOrderEstimateOption[]
  readonly currentBaselineEstimateId: string | null
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
  readonly budgetTreatment: ChangeOrderBudgetTreatment
  readonly baselineEstimate: ProjectChangeOrderEstimateOption | null
  readonly replacementEstimate: ProjectChangeOrderEstimateOption | null
  readonly replacementEstimateUrl: string | null
  readonly estimateComparisonUrl: string | null
  readonly rebaselineCompletedAt: string | null
  readonly rebaselineBlockers: readonly string[]
  readonly canExecuteRebaseline: boolean
  readonly foxitStatus: string
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
  readonly budgetTreatment: ChangeOrderBudgetTreatment
  readonly replacementEstimateId: string | null
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
  readonly budgetTreatment: ChangeOrderBudgetTreatment
  readonly replacementEstimateId: string | null
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

type RebaselineSelection = {
  readonly baseline: typeof projectEstimates.$inferSelect
  readonly replacement: typeof projectEstimates.$inferSelect
}

async function requireRebaselineSelection(input: {
  readonly context: ChangeOrderContext
  readonly projectId: string
  readonly replacementEstimateId: string | null
  readonly expectedBaselineEstimateId?: string | null
}): Promise<RebaselineSelection> {
  if (!input.replacementEstimateId) {
    throw new Error("Choose the revised estimate that will replace the baseline.")
  }
  const [baselineRows, replacementRows] = await Promise.all([
    input.context.db
      .select()
      .from(projectEstimates)
      .where(
        and(
          eq(projectEstimates.projectId, input.projectId),
          eq(projectEstimates.status, "accepted")
        )
      )
      .orderBy(desc(projectEstimates.versionNumber))
      .limit(1),
    input.context.db
      .select()
      .from(projectEstimates)
      .where(
        and(
          eq(projectEstimates.projectId, input.projectId),
          eq(projectEstimates.id, input.replacementEstimateId)
        )
      )
      .limit(1),
  ])
  const baseline = baselineRows[0]
  const replacement = replacementRows[0]
  if (!baseline) {
    throw new Error("Accept the original estimate before creating a rebaseline amendment.")
  }
  if (
    input.expectedBaselineEstimateId &&
    baseline.id !== input.expectedBaselineEstimateId
  ) {
    throw new Error("The accepted estimate changed. Review the amendment baseline again.")
  }
  if (!replacement) {
    throw new Error("The replacement estimate could not be found.")
  }
  if (
    !["draft", "internal_review", "signature_pending"].includes(
      replacement.status
    )
  ) {
    throw new Error("Choose an editable or signature-pending estimate revision.")
  }
  if (replacement.id === baseline.id) {
    throw new Error("The replacement must be a different estimate version.")
  }
  if (replacement.estimateNumber !== baseline.estimateNumber) {
    throw new Error("The replacement must be a revision of the accepted estimate.")
  }
  if (replacement.versionNumber <= baseline.versionNumber) {
    throw new Error("The replacement must be newer than the accepted estimate.")
  }
  return { baseline, replacement }
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

function estimateOption(
  row: typeof projectEstimates.$inferSelect
): ProjectChangeOrderEstimateOption {
  return {
    id: row.id,
    estimateNumber: row.estimateNumber,
    versionNumber: row.versionNumber,
    title: row.title,
    status: row.status,
    estimateTotalCents: row.estimateTotalCents,
  }
}

type RebaselineViewData = {
  readonly baselineEstimate: ProjectChangeOrderEstimateOption | null
  readonly replacementEstimate: ProjectChangeOrderEstimateOption | null
  readonly blockers: readonly string[]
}

async function rebaselineViewData(
  context: ChangeOrderContext,
  row: typeof projectChangeOrders.$inferSelect
): Promise<RebaselineViewData> {
  if (
    row.budgetTreatment !== "baseline_replacement" ||
    !row.baselineEstimateId ||
    !row.replacementEstimateId
  ) {
    return {
      baselineEstimate: null,
      replacementEstimate: null,
      blockers: [],
    }
  }

  const estimateRows = await context.db
    .select()
    .from(projectEstimates)
    .where(
      and(
        eq(projectEstimates.projectId, row.projectId),
        inArray(projectEstimates.id, [
          row.baselineEstimateId,
          row.replacementEstimateId,
        ])
      )
    )
  const baseline = estimateRows.find(
    (estimate) => estimate.id === row.baselineEstimateId
  )
  const replacement = estimateRows.find(
    (estimate) => estimate.id === row.replacementEstimateId
  )
  if (!baseline || !replacement) {
    return {
      baselineEstimate: baseline ? estimateOption(baseline) : null,
      replacementEstimate: replacement ? estimateOption(replacement) : null,
      blockers: ["A linked estimate version could not be found."],
    }
  }
  if (row.rebaselineCompletedAt) {
    return {
      baselineEstimate: estimateOption(baseline),
      replacementEstimate: estimateOption(replacement),
      blockers: [],
    }
  }

  const [
    currentBaselineRows,
    replacementLines,
    budgetRows,
    applicationRows,
    purchaseOrderRows,
    billRows,
    invoiceRows,
    paymentRows,
    executedAdjustmentRows,
  ] = await Promise.all([
    context.db
      .select({ id: projectEstimates.id })
      .from(projectEstimates)
      .where(
        and(
          eq(projectEstimates.projectId, row.projectId),
          eq(projectEstimates.status, "accepted")
        )
      )
      .orderBy(desc(projectEstimates.versionNumber))
      .limit(1),
    context.db
      .select({ id: projectEstimateLines.id })
      .from(projectEstimateLines)
      .where(eq(projectEstimateLines.estimateId, replacement.id))
      .limit(1),
    context.db
      .select({
        previousWorkCompleted: projectBudgetLines.previousWorkCompleted,
        currentWorkCompleted: projectBudgetLines.currentWorkCompleted,
        storedMaterials: projectBudgetLines.storedMaterials,
        priorCosts: projectBudgetLines.priorCosts,
        currentCosts: projectBudgetLines.currentCosts,
        totalCosts: projectBudgetLines.totalCosts,
      })
      .from(projectBudgetLines)
      .where(eq(projectBudgetLines.projectId, row.projectId)),
    context.db
      .select({
        sourceSystem: projectBudgetApplications.sourceSystem,
        status: projectBudgetApplications.status,
      })
      .from(projectBudgetApplications)
      .where(eq(projectBudgetApplications.projectId, row.projectId)),
    context.db
      .select({ status: projectOperations.status })
      .from(projectOperations)
      .where(
        and(
          eq(projectOperations.projectId, row.projectId),
          inArray(projectOperations.sourceRecordType, [
            "purchase_order",
            "google_nutech_order",
          ])
        )
      ),
    context.db
      .select({ id: vendorBills.id })
      .from(vendorBills)
      .where(eq(vendorBills.projectId, row.projectId))
      .limit(1),
    context.db
      .select({ id: invoices.id })
      .from(invoices)
      .where(eq(invoices.projectId, row.projectId))
      .limit(1),
    context.db
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.projectId, row.projectId))
      .limit(1),
    context.db
      .select({ id: projectChangeOrders.id })
      .from(projectChangeOrders)
      .where(
        and(
          eq(projectChangeOrders.projectId, row.projectId),
          ne(projectChangeOrders.id, row.id),
          eq(projectChangeOrders.budgetTreatment, "additive"),
          inArray(projectChangeOrders.status, [
            "executed",
            "sage_pending",
            "synced",
            "closed",
          ])
        )
      )
      .limit(1),
  ])

  const hasActualCosts = budgetRows.some((budgetRow) =>
    [
      budgetRow.previousWorkCompleted,
      budgetRow.currentWorkCompleted,
      budgetRow.storedMaterials,
      budgetRow.priorCosts,
      budgetRow.currentCosts,
      budgetRow.totalCosts,
    ].some((amount) => amount !== 0)
  )
  const hasPaymentApplications = applicationRows.some(
    (application) =>
      application.sourceSystem !== "compass_contract_budget_projection"
  )
  const blockers = preconstructionRebaselineBlockers({
    ownerAudience: row.audience === "owner",
    replacementEstimateFrozen: replacement.status === "signature_pending",
    replacementEstimateHasLines: replacementLines.length > 0,
    currentBaselineMatches: currentBaselineRows[0]?.id === baseline.id,
    hasActualCosts,
    hasPurchaseOrders: purchaseOrderRows.some(
      (purchaseOrder) =>
        !["void", "cancelled", "canceled"].includes(
          purchaseOrder.status.toLowerCase()
        )
    ),
    hasVendorBills: billRows.length > 0,
    hasInvoicesOrPayments: invoiceRows.length > 0 || paymentRows.length > 0,
    hasPaymentApplications,
    hasPriorExecutedAdjustments: executedAdjustmentRows.length > 0,
  })

  return {
    baselineEstimate: estimateOption(baseline),
    replacementEstimate: estimateOption(replacement),
    blockers,
  }
}

function viewModel(
  row: typeof projectChangeOrders.$inferSelect,
  context: ChangeOrderContext,
  lines: ProjectChangeOrderItem["lines"],
  documents: ProjectChangeOrderItem["documents"],
  history: ProjectChangeOrderItem["history"],
  rebaseline: RebaselineViewData
): ProjectChangeOrderItem | null {
  if (
    !isChangeOrderStatus(row.status) ||
    !validAudience(row.audience) ||
    !isChangeOrderBudgetTreatment(row.budgetTreatment) ||
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
  const links =
    row.baselineEstimateId && row.replacementEstimateId
      ? rebaselineEstimateDocumentLinks({
          projectId: row.projectId,
          baselineEstimateId: row.baselineEstimateId,
          replacementEstimateId: row.replacementEstimateId,
        })
      : null
  const canSeeRebaselineEstimates =
    context.internal || context.requesterType === "owner"

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
    budgetTreatment: row.budgetTreatment,
    baselineEstimate: canSeeRebaselineEstimates
      ? rebaseline.baselineEstimate
      : null,
    replacementEstimate: canSeeRebaselineEstimates
      ? rebaseline.replacementEstimate
      : null,
    replacementEstimateUrl: canSeeRebaselineEstimates
      ? links?.replacementEstimateUrl ?? null
      : null,
    estimateComparisonUrl: canSeeRebaselineEstimates
      ? links?.comparisonUrl ?? null
      : null,
    rebaselineCompletedAt: row.rebaselineCompletedAt,
    rebaselineBlockers: context.internal ? rebaseline.blockers : [],
    canExecuteRebaseline:
      context.internal &&
      context.canApprove &&
      row.budgetTreatment === "baseline_replacement" &&
      row.status === "signature_pending" &&
      rebaseline.blockers.length === 0,
    foxitStatus: row.foxitStatus,
    sageStatus: row.sageStatus,
    submittedAt: row.submittedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    canEdit,
    canApprove,
    allowedTransitions: transitions.filter(
      (status) =>
        status !== "synced" &&
        !(
          row.budgetTreatment === "baseline_replacement" &&
          ["executed", "sage_pending"].includes(status)
        )
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
    .map((row) =>
      viewModel(row, context, [], [], [], {
        baselineEstimate: null,
        replacementEstimate: null,
        blockers: [],
      })
    )
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
    return {
      phases: [],
      costCodes: [],
      companies: [],
      estimates: [],
      currentBaselineEstimateId: null,
    }
  }
  const [sageRows, budgetRows, contactRows, estimateRows] = await Promise.all([
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
    context.db
      .select()
      .from(projectEstimates)
      .where(eq(projectEstimates.projectId, projectId))
      .orderBy(desc(projectEstimates.versionNumber)),
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
    estimates: estimateRows.map(estimateOption),
    currentBaselineEstimateId:
      estimateRows.find((estimate) => estimate.status === "accepted")?.id ?? null,
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

  const rebaseline = await rebaselineViewData(authorizedContext, row)
  return viewModel(
    row,
    context,
    lineRows,
    documentRows,
    visibleHistory,
    rebaseline
  )
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
    const budgetTreatment: ChangeOrderBudgetTreatment = internal
      ? input.budgetTreatment
      : "additive"
    if (!isChangeOrderBudgetTreatment(budgetTreatment)) {
      return { success: false, error: "Choose a valid budget treatment." }
    }
    const rebaselineSelection =
      budgetTreatment === "baseline_replacement"
        ? await requireRebaselineSelection({
            context,
            projectId,
            replacementEstimateId: input.replacementEstimateId,
          })
        : null
    const documents = cleanDocuments(input.documents)
    const lines =
      budgetTreatment === "baseline_replacement"
        ? []
        : cleanChangeOrderCostLines(input.lines)
    const amountCents = rebaselineSelection
      ? rebaselineSelection.replacement.estimateTotalCents -
        rebaselineSelection.baseline.estimateTotalCents
      : changeOrderCostLinesTotalCents(lines)
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
      budgetTreatment,
      baselineEstimateId: rebaselineSelection?.baseline.id ?? null,
      replacementEstimateId: rebaselineSelection?.replacement.id ?? null,
      rebaselineExecutionToken: null,
      rebaselineCompletedAt: null,
      rebaselineCompletedBy: null,
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
        budgetTreatment,
        baselineEstimateId: rebaselineSelection?.baseline.id ?? null,
        replacementEstimateId: rebaselineSelection?.replacement.id ?? null,
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
    if (!isChangeOrderBudgetTreatment(existing.budgetTreatment)) {
      return { success: false, error: "The stored budget treatment is invalid." }
    }
    const budgetTreatment =
      contentAllowed && context.internal
        ? input.budgetTreatment
        : existing.budgetTreatment
    if (!isChangeOrderBudgetTreatment(budgetTreatment)) {
      return { success: false, error: "Choose a valid budget treatment." }
    }
    if (budgetTreatment === "baseline_replacement" && !context.internal) {
      return {
        success: false,
        error: "Only internal staff can configure a baseline replacement.",
      }
    }
    const rebaselineSelection =
      budgetTreatment === "baseline_replacement" &&
      !existing.rebaselineCompletedAt
        ? await requireRebaselineSelection({
            context,
            projectId,
            replacementEstimateId:
              contentAllowed && context.internal
                ? input.replacementEstimateId
                : existing.replacementEstimateId,
            expectedBaselineEstimateId: existing.baselineEstimateId,
          })
        : null
    if (
      budgetTreatment === "baseline_replacement" &&
      ["executed", "sage_pending", "synced"].includes(input.status)
    ) {
      return {
        success: false,
        error:
          "Use the guarded Rebaseline budget action to execute this amendment. Baseline replacements are not additive Sage change orders.",
      }
    }
    if (
      budgetTreatment === "baseline_replacement" &&
      input.status === "signature_pending" &&
      audience !== "owner"
    ) {
      return {
        success: false,
        error: "Make the rebaseline amendment owner visible before signature.",
      }
    }
    if (
      budgetTreatment === "baseline_replacement" &&
      input.status === "signature_pending" &&
      rebaselineSelection?.replacement.status !== "signature_pending"
    ) {
      return {
        success: false,
        error:
          "Freeze the replacement estimate for outside signature before moving the amendment to Signature Pending.",
      }
    }
    const now = new Date().toISOString()
    const documents = contentAllowed ? cleanDocuments(input.documents) : null
    const lines = contentAllowed
      ? budgetTreatment === "baseline_replacement"
        ? []
        : cleanChangeOrderCostLines(input.lines)
      : null
    const title = contentAllowed
      ? requireText(input.title, "Title", 200)
      : existing.title
    const scope = contentAllowed
      ? requireText(input.scope, "Scope", 10_000)
      : existing.scope
    const reason = contentAllowed
      ? cleanLimitedText(input.reason, "Reason", 4_000)
      : existing.reason
    const amountCents = rebaselineSelection
      ? rebaselineSelection.replacement.estimateTotalCents -
        rebaselineSelection.baseline.estimateTotalCents
      : lines
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
        budgetTreatment,
        baselineEstimateId:
          budgetTreatment === "baseline_replacement"
            ? rebaselineSelection?.baseline.id ?? existing.baselineEstimateId
            : null,
        replacementEstimateId:
          budgetTreatment === "baseline_replacement"
            ? rebaselineSelection?.replacement.id ??
              existing.replacementEstimateId
            : null,
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
          budgetTreatment,
          baselineEstimateId:
            budgetTreatment === "baseline_replacement"
              ? rebaselineSelection?.baseline.id ?? existing.baselineEstimateId
              : null,
          replacementEstimateId:
            budgetTreatment === "baseline_replacement"
              ? rebaselineSelection?.replacement.id ??
                existing.replacementEstimateId
              : null,
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

export async function executeProjectChangeOrderRebaseline(
  projectId: string,
  changeOrderId: string,
  executionNote: string | null
): Promise<ChangeOrderActionResult> {
  try {
    const context = await changeOrderContext(projectId, "read")
    await requireFeaturePermission(context.user, "change-orders", "approve")
    if (!context.internal || !context.canApprove) {
      return {
        success: false,
        error: "Change-order approval permission is required to rebaseline a budget.",
      }
    }
    const changeOrder = await context.db
      .select()
      .from(projectChangeOrders)
      .where(
        and(
          eq(projectChangeOrders.id, changeOrderId),
          eq(projectChangeOrders.projectId, projectId)
        )
      )
      .get()
    if (!changeOrder) {
      return { success: false, error: "Change order request not found." }
    }
    if (
      changeOrder.budgetTreatment !== "baseline_replacement" ||
      !changeOrder.baselineEstimateId ||
      !changeOrder.replacementEstimateId
    ) {
      return {
        success: false,
        error: "This change order is not configured as a baseline replacement.",
      }
    }
    if (changeOrder.status !== "signature_pending") {
      return {
        success: false,
        error: "The rebaseline amendment must be signature pending before execution.",
      }
    }

    const assessment = await rebaselineViewData(context, changeOrder)
    if (!assessment.replacementEstimate || assessment.blockers.length > 0) {
      return {
        success: false,
        error:
          assessment.blockers[0] ??
          "The replacement estimate could not be validated.",
      }
    }

    const preparedBudget = await rebuildProjectContractBudget({
      db: context.db,
      projectId,
      actorUserId: context.user.id,
      acceptedEstimateId: changeOrder.replacementEstimateId,
      publish: false,
    })
    if (!preparedBudget.success) {
      return {
        success: false,
        error: `The replacement budget could not be prepared: ${preparedBudget.error}`,
      }
    }

    const now = new Date().toISOString()
    const note = cleanLimitedText(executionNote, "Execution note", 2_000)
    const projectionId = `contract-budget-view:${preparedBudget.revisionId}`
    const executionToken = crypto.randomUUID()
    await context.db.batch([
      context.db
        .update(projectChangeOrders)
        .set({ rebaselineExecutionToken: executionToken, updatedAt: now })
        .where(
          and(
            eq(projectChangeOrders.id, changeOrderId),
            eq(projectChangeOrders.projectId, projectId),
            eq(projectChangeOrders.status, "signature_pending"),
            eq(projectChangeOrders.budgetTreatment, "baseline_replacement")
          )
        ),
      context.db
        .update(projectEstimates)
        .set({ status: "superseded", updatedAt: now })
        .where(
          and(
            eq(projectEstimates.projectId, projectId),
            eq(projectEstimates.id, changeOrder.baselineEstimateId),
            eq(projectEstimates.status, "accepted")
          )
        ),
      context.db
        .update(projectEstimates)
        .set({
          status: "accepted",
          foxitStatus: "completed",
          signedAt: now,
          acceptanceMethod: "external_esignature",
          acceptanceNote:
            note ??
            `Accepted through preconstruction rebaseline amendment ${changeOrder.changeOrderNumber}.`,
          acceptanceEvidenceLabel: changeOrder.changeOrderNumber,
          acceptanceRecordedByName: actorName(context.user),
          acceptedAt: now,
          acceptedBy: context.user.id,
          sageStatus: "ready",
          updatedAt: now,
        })
        .where(
          and(
            eq(projectEstimates.id, changeOrder.replacementEstimateId),
            eq(projectEstimates.projectId, projectId),
            eq(projectEstimates.status, "signature_pending")
          )
        ),
      context.db
        .update(projectContractBudgetRevisions)
        .set({ status: "superseded" })
        .where(
          and(
            eq(projectContractBudgetRevisions.projectId, projectId),
            eq(projectContractBudgetRevisions.status, "current")
          )
        ),
      context.db
        .update(projectBudgetApplications)
        .set({ status: "budget_superseded", updatedAt: now })
        .where(
          and(
            eq(projectBudgetApplications.projectId, projectId),
            eq(projectBudgetApplications.status, "budget_current"),
            eq(
              projectBudgetApplications.sourceSystem,
              "compass_contract_budget_projection"
            )
          )
        ),
      context.db
        .update(projectContractBudgetRevisions)
        .set({ status: "current" })
        .where(eq(projectContractBudgetRevisions.id, preparedBudget.revisionId)),
      context.db
        .update(projectBudgetApplications)
        .set({ status: "budget_current", ownerVisible: true, updatedAt: now })
        .where(eq(projectBudgetApplications.id, projectionId)),
      context.db
        .update(projectChangeOrders)
        .set({
          status: "executed",
          executedAt: now,
          rebaselineCompletedAt: now,
          rebaselineCompletedBy: context.user.id,
          foxitStatus: "completed",
          sageStatus: "not_applicable_rebaseline",
          updatedAt: now,
        })
        // Migration 0148 guards this status write against financial activity
        // created after the read-side eligibility check. Any blocker aborts the
        // entire D1 batch, including estimate and budget activation above.
        .where(
          and(
            eq(projectChangeOrders.id, changeOrderId),
            eq(projectChangeOrders.projectId, projectId),
            eq(projectChangeOrders.status, "signature_pending"),
            eq(projectChangeOrders.rebaselineExecutionToken, executionToken)
          )
        ),
      context.db.insert(projectChangeOrderHistory).values({
        id: crypto.randomUUID(),
        projectId,
        changeOrderId,
        eventType: "baseline_replaced",
        fromStatus: "signature_pending",
        toStatus: "executed",
        actorUserId: context.user.id,
        actorName: actorName(context.user),
        actorRole: context.user.role,
        note,
        metadataJson: JSON.stringify({
          budgetTreatment: "baseline_replacement",
          baselineEstimateId: changeOrder.baselineEstimateId,
          replacementEstimateId: changeOrder.replacementEstimateId,
          executionToken,
        }),
        createdAt: now,
      }),
    ])

    revalidateChangeOrderPaths(projectId)
    revalidatePath(`/dashboard/projects/${projectId}/estimate`)
    revalidatePath(`/dashboard/projects/${projectId}/financials`)
    return { success: true, id: changeOrderId }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to execute the preconstruction rebaseline.",
    }
  }
}
