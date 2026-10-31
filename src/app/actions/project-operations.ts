"use server"

import { and, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { projectFinishSelections, projectOperations } from "@/db/schema"
import { projectRfqBidApprovals, projectRfqEmailDeliveries, projectRfqManualResponseEvents } from "@/db/schema-rfqs"
import { projectSelectionProcurementLinks } from "@/db/schema-selection-decisions"
import { errorMessage } from "@/lib/action-result"
import { loadProjectCostCodeChoices } from "@/lib/cost-codes/catalog-server"
import { operationsContext } from "@/lib/domain/operations/access"
import {
  countProjectOperations,
  loadOperationsSummary,
  loadProjectOperation,
  loadProjectSageNumbers,
  loadRfqCostCodeOptions,
  loadRfqs,
} from "@/lib/domain/operations/queries"
import { parseJsonRecord, parseRfqScopeItems, parseRfqTemplateReview, stringValue } from "@/lib/domain/operations/records"
import {
  normalizeRfqDocumentLinks,
  normalizeRfqScopeLines,
  projectDocumentNumberFor,
  requireText,
  sageRfpLink,
  sageShortProjectDocumentNumberFor,
} from "@/lib/domain/operations/rules"
import {
  deleteOperations,
  insertOperations,
  operationInsertQuery,
  updateOperations,
  type OperationInsert,
} from "@/lib/domain/operations/store"
import type {
  CreateRfqRequestInput,
  DuplicateRfqRequestInput,
  NormalizedRfqScopeLine,
  ProjectOperationActionResult,
  ProjectOperationKind,
  ProjectOperationsSummary,
  ProjectRfqCostCodeOption,
  ProjectRfqItem,
  ProjectRfqScopeLineItem,
  UpdateRfqRequestInput,
} from "@/lib/domain/operations/types"
import { markPaperTrailDue } from "@/lib/paper-trail/enqueue"
import { isPurchaseOrderStatus, isRfqStatus } from "@/lib/project-operations/status"
import { parsePortalRfqPayload } from "@/lib/rfqs/portal-response"
import { rfqScopeCodingErrors } from "@/lib/rfqs/cost-codes"
import { specificationJson } from "@/lib/selections/decisions"
import { orgContext, type Db } from "@/lib/server/action-context"
import { cleanText } from "@/lib/shared/guards"
import { findTemplatePlaceholders } from "@/lib/templates/template-bid-package"
import { isInternalStaffRole } from "@/lib/user-roles"

/*
 * The project operations overview, status changes, and RFQs. Staff of the
 * project's organization with the feature permission read and change them
 * (operations access, "organization" scope). To-dos, purchase orders, and
 * the Sage queue have their own action files.
 */

export async function getProjectOperationsSummary(projectId: string): Promise<ProjectOperationsSummary> {
  const { db, user } = await operationsContext(projectId, "project-hub", false)
  const canViewWorkingSchedule = isInternalStaffRole(user.role) || user.role === "developer"
  return loadOperationsSummary(db, projectId, canViewWorkingSchedule)
}

export async function getProjectRfqCostCodeOptions(projectId: string): Promise<readonly ProjectRfqCostCodeOption[]> {
  const { db } = await operationsContext(projectId, "rfqs", false)
  return loadRfqCostCodeOptions(db, projectId)
}

export async function getProjectRfqs(projectId: string): Promise<readonly ProjectRfqItem[]> {
  const { db, organizationId } = await operationsContext(projectId, "rfqs", false)
  return loadRfqs(db, projectId, organizationId)
}

export async function updateProjectOperationStatus(
  projectId: string,
  operationId: string,
  operationKind: ProjectOperationKind,
  requestedStatus: string,
): Promise<ProjectOperationActionResult> {
  try {
    if (operationKind === "rfq" && requestedStatus === "awarded") {
      const approver = await orgContext({ feature: "rfqs", action: "approve" })
      if (!approver.success) throw new Error(approver.error)
    }
    const { db } = await operationsContext(
      projectId,
      operationKind === "purchase_order" ? "purchase-orders" : "rfqs",
      true,
    )
    const statusIsValid =
      operationKind === "purchase_order" ? isPurchaseOrderStatus(requestedStatus) : isRfqStatus(requestedStatus)
    if (!statusIsValid) {
      return { success: false, error: "Please choose a valid status." }
    }

    const existing = await loadProjectOperation(db, projectId, operationId, operationKind)
    if (!existing) {
      return {
        success: false,
        error: operationKind === "purchase_order" ? "Purchase order not found." : "RFQ not found.",
      }
    }
    if (operationKind === "rfq") {
      const approval = await db
        .select({ id: projectRfqBidApprovals.id })
        .from(projectRfqBidApprovals)
        .where(eq(projectRfqBidApprovals.rfqOperationId, operationId))
        .limit(1)
        .then((rows) => rows[0] ?? null)
      if (approval && requestedStatus !== "awarded") {
        return { success: false, error: "An approved RFQ is locked. Its awarded status cannot be changed." }
      }
      if (!approval && requestedStatus === "awarded") {
        return { success: false, error: "Approve the submitted bid before marking this RFQ awarded." }
      }
    }

    await updateOperations(
      db,
      and(
        eq(projectOperations.id, operationId),
        eq(projectOperations.projectId, projectId),
        eq(projectOperations.sourceRecordType, operationKind),
      ),
      { status: requestedStatus, updatedAt: new Date().toISOString() },
    )

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/${operationKind === "purchase_order" ? "purchase-orders" : "rfqs"}`)
    revalidatePath("/dashboard/purchase-orders")
    revalidatePath("/dashboard/financials")
    revalidatePath("/dashboard/schedule")
    revalidatePath("/dashboard")
    if (operationKind === "rfq") {
      revalidatePath(`/preview/projects/${projectId}/sub-vendor/rfqs`)
    } else {
      await markPaperTrailDue(db, { projectId, recordType: "purchase_order", recordId: operationId })
    }
    return { success: true, id: operationId }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to update status.") }
  }
}

async function validateRfqScopeCostCodes(
  db: Db,
  projectId: string,
  lines: readonly NormalizedRfqScopeLine[],
  existingLines: readonly ProjectRfqScopeLineItem[] = [],
): Promise<void> {
  if (lines.every((line) => !line.costCode && !line.phaseCode)) return
  const activeRows = await loadProjectCostCodeChoices(db, projectId)
  const issues = rfqScopeCodingErrors(
    lines,
    new Map(activeRows.map((row) => [row.code, row.divisionCode])),
    new Set(activeRows.map((row) => row.divisionCode)),
    existingLines,
  )
  if (issues.length > 0) throw new Error(issues.join(" "))
}

function revalidateRfqPaths(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}`)
  revalidatePath(`/dashboard/projects/${projectId}/rfqs`)
  revalidatePath(`/dashboard/projects/${projectId}/financials`)
  revalidatePath("/dashboard")
}

export async function createRfqRequest(
  projectId: string,
  input: CreateRfqRequestInput,
): Promise<ProjectOperationActionResult> {
  try {
    const { db } = await operationsContext(projectId, "rfqs", true)
    const [project, rfqCount] = await Promise.all([
      loadProjectSageNumbers(db, projectId),
      countProjectOperations(db, projectId, ["rfq"]),
    ])

    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const title = requireText(input.title, "Title")
    const description = cleanText(input.scope)
    const requestedFrom = cleanText(input.requestedFrom)
    const vendorCategory = cleanText(input.vendorCategory)
    const recipientEmail = cleanText(input.recipientEmail)
    const responseDueDate = cleanText(input.responseDueDate)
    const scopeItems = normalizeRfqScopeLines(input.scopeItems, description ?? title)
    await validateRfqScopeCostCodes(db, projectId, scopeItems)
    const documentLinks = normalizeRfqDocumentLinks(input.documentLinks)
    const primaryLine = scopeItems[0] ?? null
    const sourceRecordNumber = projectDocumentNumberFor(project?.projectNumber ?? null, "RFQ", rfqCount)
    const sageShortRecordNumber = sageShortProjectDocumentNumberFor(project?.projectNumber ?? null, "RFQ", rfqCount)
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
      // RFQs from one estimate pricing package share a bid package, the same
      // grouping "Duplicate for another vendor" uses.
      ...(input.estimatePackage ? { estimatePackage: input.estimatePackage, bidPackageId: input.estimatePackage.id } : {}),
      sageRfp: sageRfpLink(sageShortRecordNumber),
    }

    const selectionIds = [...new Set(input.scopeItems.flatMap((line) => (line.selectionId ? [line.selectionId] : [])))]
    if (selectionIds.length > 50) throw new Error("Import no more than 50 selections per RFQ.")
    const selections = selectionIds.length
      ? await db
          .select()
          .from(projectFinishSelections)
          .where(and(eq(projectFinishSelections.projectId, projectId), inArray(projectFinishSelections.id, selectionIds)))
      : []
    if (selections.length !== selectionIds.length) {
      throw new Error("A linked selection is no longer available in this project.")
    }
    const row: OperationInsert = {
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
    }

    // The RFQ and its source specifications are committed together. The
    // procurement links belong to the selections area.
    if (selections.length) {
      await db.batch([
        operationInsertQuery(db, row),
        ...selections.map((selection) =>
          db.insert(projectSelectionProcurementLinks).values({
            id: crypto.randomUUID(),
            projectId,
            selectionId: selection.id,
            operationId: id,
            specificationJson: specificationJson(selection),
            createdAt: now,
          }),
        ),
      ])
    } else {
      await insertOperations(db, row)
    }
    revalidatePath(`/dashboard/projects/${projectId}/selections`)
    revalidateRfqPaths(projectId)
    return { success: true, id }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to create request for quote") }
  }
}

export async function duplicateRfqRequest(
  projectId: string,
  rfqId: string,
  input: DuplicateRfqRequestInput,
): Promise<ProjectOperationActionResult> {
  try {
    const { db } = await operationsContext(projectId, "rfqs", true)
    const [project, source, rfqCount] = await Promise.all([
      loadProjectSageNumbers(db, projectId),
      loadProjectOperation(db, projectId, rfqId, "rfq"),
      countProjectOperations(db, projectId, ["rfq"]),
    ])
    if (!source) return { success: false, error: "RFQ not found." }

    const requestedFrom = requireText(input.requestedFrom, "Vendor or subcontractor")
    const recipientEmail = requireText(input.recipientEmail, "Recipient email").toLowerCase()
    if (!/^\S+@\S+\.\S+$/.test(recipientEmail)) {
      return { success: false, error: "Enter a valid recipient email." }
    }

    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const sourceRecordNumber = projectDocumentNumberFor(project?.projectNumber ?? null, "RFQ", rfqCount)
    const sageShortRecordNumber = sageShortProjectDocumentNumberFor(project?.projectNumber ?? null, "RFQ", rfqCount)
    const sourcePayload = parseJsonRecord(source.sagePayloadJson) ?? {}
    const payload = {
      ...sourcePayload,
      source: "compass_rfq",
      jobId: project?.sageJobId ?? null,
      jobNumber: project?.sageJobNumber ?? null,
      rfqNumber: sourceRecordNumber,
      sageShortRfqNumber: sageShortRecordNumber,
      requestedFrom,
      recipientEmail,
      vendorResponse: null,
      duplicateOfRfqId: source.id,
      bidPackageId: stringValue(sourcePayload, "bidPackageId") ?? source.id,
      sageRfp: sageRfpLink(sageShortRecordNumber),
    }

    await insertOperations(db, {
      id,
      projectId,
      sourceSystem: "compass",
      sourceRecordType: "rfq",
      sourceRecordNumber,
      title: source.title,
      description: source.description,
      status: "draft",
      priority: source.priority,
      assigneeType: "vendor",
      assigneeName: requestedFrom,
      siteContactPhone: source.siteContactPhone,
      companyName: requestedFrom,
      costCode: source.costCode,
      startDate: source.startDate,
      dueDate: source.dueDate,
      sageJobId: project?.sageJobId ?? null,
      sageJobNumber: project?.sageJobNumber ?? null,
      sageVendorName: requestedFrom,
      sagePhaseCode: source.sagePhaseCode,
      sageCostCode: source.sageCostCode,
      sageWriteStatus: "not_ready",
      sagePayloadJson: JSON.stringify(payload),
      syncDirection: "write",
      syncStatus: "compass_only",
      createdAt: now,
      updatedAt: now,
    })

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/rfqs`)
    revalidatePath("/dashboard")
    return { success: true, id }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to duplicate RFQ.") }
  }
}

export async function updateRfqRequest(
  projectId: string,
  rfqId: string,
  input: UpdateRfqRequestInput,
): Promise<ProjectOperationActionResult> {
  try {
    const { db } = await operationsContext(projectId, "rfqs", true)
    const [project, existing] = await Promise.all([
      loadProjectSageNumbers(db, projectId),
      loadProjectOperation(db, projectId, rfqId, "rfq"),
    ])
    if (!existing) return { success: false, error: "RFQ not found." }
    const existingVendorResponse = parsePortalRfqPayload(existing.sagePayloadJson).vendorResponse
    if (existingVendorResponse !== null) {
      return {
        success: false,
        error: "A submitted RFQ response is immutable. Duplicate the RFQ for a new request.",
      }
    }

    const now = new Date().toISOString()
    const title = requireText(input.title, "Title")
    const description = cleanText(input.scope)
    const requestedFrom = cleanText(input.requestedFrom)
    const vendorCategory = cleanText(input.vendorCategory)
    const recipientEmail = cleanText(input.recipientEmail)
    const responseDueDate = cleanText(input.responseDueDate)
    const scopeItems = normalizeRfqScopeLines(input.scopeItems, description ?? title)
    const existingPayload = parseJsonRecord(existing.sagePayloadJson)
    await validateRfqScopeCostCodes(db, projectId, scopeItems, parseRfqScopeItems(existingPayload, existing.description))
    const documentLinks = normalizeRfqDocumentLinks(input.documentLinks)
    const existingTemplateReview = parseRfqTemplateReview(existingPayload)
    const templateReview = existingTemplateReview
      ? {
          unresolvedPlaceholders: findTemplatePlaceholders([
            title,
            description,
            ...scopeItems.flatMap((line) => [line.description, line.notes]),
          ]),
          requiresDocumentPackage: existingTemplateReview.requiresDocumentPackage && documentLinks.length === 0,
        }
      : null
    const primaryLine = scopeItems[0] ?? null
    const sourceRecordNumber =
      existing.sourceRecordNumber ?? projectDocumentNumberFor(project?.projectNumber ?? null, "RFQ", 0)
    const sageShortRecordNumber = sageShortProjectDocumentNumberFor(project?.projectNumber ?? null, "RFQ", 0)
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
      vendorResponse: existingVendorResponse,
      // Editing keeps the RFQ in its bid package.
      bidPackageId: existingPayload?.bidPackageId ?? null,
      estimatePackage: existingPayload?.estimatePackage ?? null,
      templateReview:
        templateReview && (templateReview.unresolvedPlaceholders.length > 0 || templateReview.requiresDocumentPackage)
          ? templateReview
          : null,
      sageRfp: sageRfpLink(sageShortRecordNumber),
    }

    await updateOperations(db, and(eq(projectOperations.id, rfqId), eq(projectOperations.projectId, projectId)), {
      title,
      description,
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
      sagePayloadJson: JSON.stringify(payload),
      syncStatus: existing.syncStatus === "pending_sage" ? "pending_sage" : "compass_only",
      updatedAt: now,
    })

    revalidateRfqPaths(projectId)
    return { success: true, id: rfqId }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to update request for quote") }
  }
}

export async function deleteRfqRequest(projectId: string, rfqId: string): Promise<ProjectOperationActionResult> {
  try {
    const { db } = await operationsContext(projectId, "rfqs", true)
    const existing = await loadProjectOperation(db, projectId, rfqId, "rfq")
    if (!existing) return { success: false, error: "RFQ not found." }
    if (existing.status !== "draft") {
      return {
        success: false,
        error: "Only an unsent RFQ draft can be deleted. Close or void a shared RFQ instead.",
      }
    }

    const [delivery, manualResponse] = await Promise.all([
      db
        .select({ id: projectRfqEmailDeliveries.id })
        .from(projectRfqEmailDeliveries)
        .where(eq(projectRfqEmailDeliveries.rfqOperationId, rfqId))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      db
        .select({ id: projectRfqManualResponseEvents.id })
        .from(projectRfqManualResponseEvents)
        .where(eq(projectRfqManualResponseEvents.rfqOperationId, rfqId))
        .limit(1)
        .then((rows) => rows[0] ?? null),
    ])
    if (delivery || manualResponse) {
      return {
        success: false,
        error: "This RFQ has delivery or response history. Void it to preserve that record.",
      }
    }

    await deleteOperations(
      db,
      and(
        eq(projectOperations.id, rfqId),
        eq(projectOperations.projectId, projectId),
        eq(projectOperations.sourceRecordType, "rfq"),
      ),
    )
    revalidateRfqPaths(projectId)
    return { success: true, id: rfqId }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to delete request for quote") }
  }
}
