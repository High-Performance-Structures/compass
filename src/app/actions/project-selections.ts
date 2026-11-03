"use server"

import { and, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { projectFinishSelections, projectOperations, projects } from "@/db/schema"
import { staffSelectionContext } from "@/lib/domain/selections/access"
import {
  applyFinishScheduleImport,
  finishScheduleImportAccess,
  loadFinishSchedule
} from "@/lib/domain/selections/finish-schedule-import"
import { insertOperations } from "@/lib/domain/operations/store"
import {
  changedNumberField,
  changedTextField,
  compassSelectionRoomId,
  finishSchedulePreview,
  isSelectionStatus,
  normalizedChoiceOptions,
  normalizeStatus,
  parseQuantity,
  projectTaskNumberFor,
  requiredText
} from "@/lib/domain/selections/rules"
import {
  deleteFinishSelectionsReturningIds,
  insertFinishSelection,
  insertSelectionRoomIfAbsent,
  updateFinishSelections
} from "@/lib/domain/selections/store"
import type {
  ApplyProjectFinishScheduleImportResult,
  CreateProjectSelectionInput,
  ProjectFinishScheduleImportResult,
  ProjectSelectionOptions,
  ProjectSelectionsSummary,
  UpdateProjectSelectionInput
} from "@/lib/domain/selections/types"
import {
  loadProjectSelectionOptions,
  loadProjectSelections,
  loadPublishedTemplateSelection
} from "@/lib/domain/selections/workspace"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { selectionDeletionAllowed } from "@/lib/selections/deletion"
import { cleanText } from "@/lib/shared/guards"

/*
 * Staff finish-selection actions. Access is the staff selections rule in
 * src/lib/domain/selections/access.ts; reads, import reconciliation and the
 * rules live in src/lib/domain/selections. Selection writes go through the
 * selections store. The project_operations follow-up rows written below are
 * owned by the operations module and are left here as they were.
 */

type ActionResult =
  | { readonly success: true; readonly id?: string }
  | { readonly success: false; readonly error: string }

/** Throws "Project not found" and the other access errors, as before. */
export async function getProjectSelections(projectId: string): Promise<ProjectSelectionsSummary> {
  const { db } = await staffSelectionContext(projectId, "read")
  return loadProjectSelections(db, projectId)
}

export async function previewProjectFinishScheduleImport(
  projectId: string,
  workbookUrl: string
): Promise<ProjectFinishScheduleImportResult> {
  try {
    const access = await finishScheduleImportAccess(
      await staffSelectionContext(projectId, "update")
    )
    const loaded = await loadFinishSchedule(access, workbookUrl)
    return {
      success: true,
      preview: finishSchedulePreview(loaded, access.projectNumber)
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Unable to preview the finish schedule workbook."
    }
  }
}

export async function importProjectFinishSchedule(
  projectId: string,
  workbookUrl: string
): Promise<ApplyProjectFinishScheduleImportResult> {
  try {
    const access = await finishScheduleImportAccess(
      await staffSelectionContext(projectId, "update")
    )
    const loaded = await loadFinishSchedule(access, workbookUrl)
    const preview = finishSchedulePreview(loaded, access.projectNumber)
    if (preview.projectMatch !== "match") {
      throw new Error(
        preview.projectMatch === "mismatch"
          ? `This workbook belongs to ${preview.workbookProjectNumber ?? "another project"}, not ${preview.compassProjectNumber ?? "this Compass project"}.`
          : "Add matching project numbers to the workbook and Compass before importing."
      )
    }
    if (loaded.parsed.selections.length === 0) {
      throw new Error("The workbook contains no finish selections to import.")
    }

    const counts = await applyFinishScheduleImport(access.db, projectId, loaded)

    revalidatePath(`/dashboard/projects/${projectId}/selections`)
    revalidatePath(`/dashboard/projects/${projectId}`)
    return {
      success: true,
      ...counts,
      roomCount: loaded.parsed.rooms.length
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Unable to import the finish schedule workbook."
    }
  }
}

/** Throws "Project not found" and the other access errors, as before. */
export async function getProjectSelectionOptions(
  projectId: string
): Promise<ProjectSelectionOptions> {
  const { db } = await staffSelectionContext(projectId, "read")
  return loadProjectSelectionOptions(db, projectId)
}

export async function requestSelectionCostCodeSageReview(
  projectId: string,
  costCode: string
): Promise<ActionResult> {
  try {
    const cleanedCostCode = requiredText(costCode, "Cost code")
    const { db } = await staffSelectionContext(projectId, "update")
    const now = new Date().toISOString()

    const [existing] = await db
      .select({ id: projectOperations.id })
      .from(projectOperations)
      .where(
        and(
          eq(projectOperations.projectId, projectId),
          eq(projectOperations.sourceRecordType, "sage_cost_code_request"),
          eq(projectOperations.costCode, cleanedCostCode),
          eq(projectOperations.syncStatus, "needs_review")
        )
      )
      .limit(1)

    if (!existing) {
      const id = crypto.randomUUID()
      await insertOperations(db, {
        id, projectId,
        sourceSystem: "compass",
        sourceRecordType: "sage_cost_code_request",
        sourceRecordId: cleanedCostCode,
        sourceRecordNumber: cleanedCostCode,
        title: `Add Sage cost code ${cleanedCostCode}`,
        description:
          "Compass finish selections reference this CSI cost code, but it is not currently in the Sage cost code list.",
        status: "open",
        priority: "normal",
        costCode: cleanedCostCode,
        sageCostCode: cleanedCostCode,
        sageWriteStatus: "needs_review",
        sagePayloadJson: JSON.stringify({
          source: "compass_finish_selection",
          requestedCostCode: cleanedCostCode
        }),
        syncDirection: "write",
        syncStatus: "needs_review",
        createdAt: now,
        updatedAt: now
      })
    }

    await updateFinishSelections(
      db,
      and(
        eq(projectFinishSelections.projectId, projectId),
        eq(projectFinishSelections.costCode, cleanedCostCode)
      ),
      {
        syncStatus: "needs_sage_review",
        updatedAt: now
      }
    )

    revalidatePath(`/dashboard/projects/${projectId}/selections`)
    revalidatePath(`/dashboard/projects/${projectId}`)
    return { success: true, id: existing?.id }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to request Sage cost code review"
    }
  }
}

export async function createProjectSelection(
  projectId: string,
  input: CreateProjectSelectionInput
): Promise<ActionResult> {
  try {
    const { db, organizationId } = await staffSelectionContext(projectId, "update")
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const roomName = requiredText(input.roomName, "Room")
    const roomType = cleanText(input.roomType)
    const templateId = cleanText(input.templateId ?? null)
    const templateContentItemId = cleanText(input.templateContentItemId ?? null)
    if (Boolean(templateId) !== Boolean(templateContentItemId)) {
      throw new Error("Choose both a template and one of its finish selections.")
    }
    const templateSelection =
      templateId && templateContentItemId
        ? await loadPublishedTemplateSelection(
            db,
            organizationId,
            templateId,
            templateContentItemId
          )
        : null
    if (templateId && templateContentItemId && !templateSelection) {
      throw new Error("That published template finish selection is no longer available.")
    }
    const choiceOptions = normalizedChoiceOptions(
      templateSelection?.choiceOptions ?? input.choiceOptions
    )

    await insertSelectionRoomIfAbsent(db, {
      id: compassSelectionRoomId(projectId, roomName),
      projectId,
      sourceSystem: "compass",
      roomName,
      roomType,
      sortOrder: 1_000,
      createdAt: now,
      updatedAt: now
    })

    await insertFinishSelection(db, {
      id,
      projectId,
      sourceSystem: templateSelection ? "compass_template" : "compass",
      sourceRecordId: templateSelection
        ? `${templateSelection.templateId}:${templateSelection.templateContentItemId}`
        : null,
      roomName,
      roomType,
      category: cleanText(input.category) ?? "Uncategorized",
      name: requiredText(input.name, "Selection name"),
      description: cleanText(input.description),
      quantity: parseQuantity(input.quantity),
      manufacturer: cleanText(input.manufacturer),
      model: cleanText(input.model),
      colorFinish: cleanText(input.colorFinish),
      choiceOptionsJson: choiceOptions.length > 0 ? JSON.stringify(choiceOptions) : null,
      supplierName: cleanText(input.supplierName),
      productUrl: cleanText(input.productUrl),
      costCode: cleanText(input.costCode),
      phaseCode: cleanText(input.phaseCode),
      status: normalizeStatus(input.status),
      notes: cleanText(input.notes),
      syncStatus: "manual",
      createdAt: now,
      updatedAt: now
    })

    revalidatePath(`/dashboard/projects/${projectId}/selections`)
    revalidatePath(`/dashboard/projects/${projectId}`)
    return { success: true, id }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create selection"
    }
  }
}

export async function updateProjectSelection(
  projectId: string,
  selectionId: string,
  input: UpdateProjectSelectionInput
): Promise<ActionResult> {
  try {
    const { db } = await staffSelectionContext(projectId, "update")
    const now = new Date().toISOString()
    const roomName = requiredText(input.roomName, "Room")
    const roomType = cleanText(input.roomType)
    const category = cleanText(input.category) ?? "Uncategorized"
    const name = requiredText(input.name, "Selection name")
    const description = cleanText(input.description)
    const quantity = parseQuantity(input.quantity)
    const manufacturer = cleanText(input.manufacturer)
    const model = cleanText(input.model)
    const colorFinish = cleanText(input.colorFinish)
    const supplierName = cleanText(input.supplierName)
    const productUrl = cleanText(input.productUrl)
    const costCode = cleanText(input.costCode)
    const phaseCode = cleanText(input.phaseCode)
    const status = normalizeStatus(input.status)
    const notes = cleanText(input.notes)
    const changeReason = cleanText(input.changeReason)

    const [existing] = await db
      .select()
      .from(projectFinishSelections)
      .where(
        and(
          eq(projectFinishSelections.id, selectionId),
          eq(projectFinishSelections.projectId, projectId)
        )
      )
      .limit(1)

    if (!existing) {
      return { success: false, error: "Selection not found." }
    }

    const changes = [
      changedTextField("Room", existing.roomName, roomName),
      changedTextField("Room type", existing.roomType, roomType),
      changedTextField("Category", existing.category, category),
      changedTextField("Selection", existing.name, name),
      changedTextField("Description", existing.description, description),
      changedNumberField("Quantity", existing.quantity, quantity),
      changedTextField("Manufacturer", existing.manufacturer, manufacturer),
      changedTextField("Model", existing.model, model),
      changedTextField("Color / finish", existing.colorFinish, colorFinish),
      changedTextField("Supplier", existing.supplierName, supplierName),
      changedTextField("Product link", existing.productUrl, productUrl),
      changedTextField("Cost code", existing.costCode, costCode),
      changedTextField("Phase", existing.phaseCode, phaseCode),
      changedTextField("Status", existing.status, status),
      changedTextField("Notes", existing.notes, notes)
    ].filter((change) => change !== null)
    const specificationChanged = changes.some(change => change.field !== "Status" && change.field !== "Notes")

    await insertSelectionRoomIfAbsent(db, {
      id: compassSelectionRoomId(projectId, roomName),
      projectId,
      sourceSystem: "compass",
      roomName,
      roomType,
      sortOrder: 1_000,
      createdAt: now,
      updatedAt: now
    })

    await updateFinishSelections(
      db,
      and(
        eq(projectFinishSelections.id, selectionId),
        eq(projectFinishSelections.projectId, projectId)
      ),
      {
        roomName,
        roomType,
        category,
        name,
        description,
        quantity,
        manufacturer,
        model,
        colorFinish,
        supplierName,
        productUrl,
        costCode,
        phaseCode,
        status,
        // Staff workflow status is not an owner signature. Material edits invalidate it.
        ownerApproved: specificationChanged ? false : existing.ownerApproved,
        approvedBy: specificationChanged ? null : existing.approvedBy,
        approvedAt: specificationChanged ? null : existing.approvedAt,
        notes,
        syncStatus:
          existing.status === "approved" && changes.length > 0
            ? "selection_change_review"
            : existing.sourceSystem === "google_sheets" && changes.length > 0
              ? "manual_edit"
              : existing.syncStatus,
        updatedAt: now
      }
    )

    if (existing.status === "approved" && changes.length > 0) {
      const logId = crypto.randomUUID()
      const changeOrderReviewId = crypto.randomUUID()
      const pmTaskId = crypto.randomUUID()
      const adminTaskId = crypto.randomUUID()
      const [project] = await db
        .select({
          projectManager: projects.projectManager,
          sageJobId: projects.sageJobId,
          sageJobNumber: projects.sageJobNumber
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
              "staff_task",
              "subcontractor_task",
              "supplier_task",
              "schedule_task"
            ])
          )
        )
      const payload = {
        source: "compass_finish_selection",
        selectionId,
        selectionName: existing.name,
        changeReason,
        changes
      }

      await insertOperations(db, {
        id: logId,
        projectId,
        sourceSystem: "compass",
        sourceRecordType: "selection_change_log",
        sourceRecordId: selectionId,
        title: `Finish selection changed: ${existing.name}`,
        description:
          changeReason ??
          "Approved finish selection was edited and should be shared with affected subs/suppliers.",
        status: "open",
        priority: "normal",
        costCode,
        sageCostCode: costCode,
        sageWriteStatus: "not_ready",
        sagePayloadJson: JSON.stringify(payload),
        syncDirection: "write",
        syncStatus: "compass_only",
        createdAt: now,
        updatedAt: now
      })

      await insertOperations(db, {
        id: changeOrderReviewId,
        projectId,
        sourceSystem: "compass",
        sourceRecordType: "selection_change_order_review",
        sourceRecordId: selectionId,
        title: `Review change order impact: ${existing.name}`,
        description:
          "Approved finish selection changed. Review contract phase, schedule cutoff, RFQs/POs, and whether an owner change order is required.",
        status: "open",
        priority: "high",
        costCode,
        sageCostCode: costCode,
        sageWriteStatus: "needs_review",
        sagePayloadJson: JSON.stringify(payload),
        syncDirection: "write",
        syncStatus: "needs_review",
        createdAt: now,
        updatedAt: now
      })

      await insertOperations(db, {
        id: pmTaskId,
        projectId,
        sourceSystem: "compass",
        sourceRecordType: "staff_task",
        sourceRecordId: selectionId,
        sourceRecordNumber: projectTaskNumberFor(taskRows.length),
        title: `Review approved selection change: ${existing.name}`,
        description:
          "Review the approved finish selection edit for schedule, RFQ, PO, and change-order impact.",
        status: "open",
        priority: "high",
        assigneeType: "internal",
        assigneeName: project?.projectManager ?? "Project Manager",
        costCode,
        sageJobId: project?.sageJobId ?? null,
        sageJobNumber: project?.sageJobNumber ?? null,
        sageCostCode: costCode,
        sageWriteStatus: "not_ready",
        sagePayloadJson: JSON.stringify({
          ...payload,
          taskRole: "project_manager",
          linkedChangeOrderReviewId: changeOrderReviewId
        }),
        syncDirection: "write",
        syncStatus: "compass_only",
        createdAt: now,
        updatedAt: now
      })

      await insertOperations(db, {
        id: adminTaskId,
        projectId,
        sourceSystem: "compass",
        sourceRecordType: "staff_task",
        sourceRecordId: selectionId,
        sourceRecordNumber: projectTaskNumberFor(taskRows.length + 1),
        title: `Share selection change: ${existing.name}`,
        description:
          "Notify affected subs/suppliers and update any RFQ, PO, or jobsite finish schedule packet tied to this selection.",
        status: "open",
        priority: "normal",
        assigneeType: "internal",
        assigneeName: "Project Administrator",
        costCode,
        sageJobId: project?.sageJobId ?? null,
        sageJobNumber: project?.sageJobNumber ?? null,
        sageCostCode: costCode,
        sageWriteStatus: "not_ready",
        sagePayloadJson: JSON.stringify({
          ...payload,
          taskRole: "project_administrator",
          linkedChangeLogId: logId
        }),
        syncDirection: "write",
        syncStatus: "compass_only",
        createdAt: now,
        updatedAt: now
      })
    }

    revalidatePath(`/dashboard/projects/${projectId}/selections`)
    revalidatePath(`/dashboard/projects/${projectId}`)
    return { success: true, id: selectionId }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update selection"
    }
  }
}

export async function updateProjectSelectionStatus(
  projectId: string,
  selectionId: string,
  status: string
): Promise<ActionResult> {
  try {
    if (!isSelectionStatus(status)) {
      return { success: false, error: "Unsupported selection status." }
    }

    const { db } = await staffSelectionContext(projectId, "update")
    const now = new Date().toISOString()
    const [existing] = await db
      .select()
      .from(projectFinishSelections)
      .where(
        and(
          eq(projectFinishSelections.id, selectionId),
          eq(projectFinishSelections.projectId, projectId)
        )
      )
      .limit(1)

    if (!existing) {
      return { success: false, error: "Selection not found." }
    }

    await updateFinishSelections(
      db,
      and(
        eq(projectFinishSelections.id, selectionId),
        eq(projectFinishSelections.projectId, projectId)
      ),
      {
        status,
        // Only the authenticated owner decision action records owner approval.
        ownerApproved: existing.ownerApproved,
        approvedAt: existing.approvedAt,
        syncStatus:
          status === "unavailable" && existing.status !== "unavailable"
            ? "selection_change_review"
            : existing.syncStatus,
        updatedAt: now
      }
    )

    if (status === "unavailable" && existing.status !== "unavailable") {
      const reviewId = crypto.randomUUID()
      const pmTaskId = crypto.randomUUID()
      const adminTaskId = crypto.randomUUID()
      const [project] = await db
        .select({
          projectManager: projects.projectManager,
          sageJobId: projects.sageJobId,
          sageJobNumber: projects.sageJobNumber
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
              "staff_task",
              "subcontractor_task",
              "supplier_task",
              "schedule_task"
            ])
          )
        )
      const payload = {
        source: "compass_finish_selection",
        selectionId,
        selectionName: existing.name,
        previousStatus: existing.status,
        nextStatus: status,
        requiredFollowUp: [
          "Confirm product availability issue.",
          "Ask owner to select an alternate.",
          "Review RFQ, PO, schedule, and change-order impact."
        ]
      }

      await insertOperations(db, {
        id: reviewId,
        projectId,
        sourceSystem: "compass",
        sourceRecordType: "selection_unavailable_review",
        sourceRecordId: selectionId,
        title: `Selection unavailable: ${existing.name}`,
        description:
          "Selection was marked unavailable. Owner needs an alternate, and the team should review schedule, RFQ/PO, and change-order impact.",
        status: "open",
        priority: "high",
        costCode: existing.costCode,
        sageCostCode: existing.costCode,
        sageWriteStatus: "needs_review",
        sagePayloadJson: JSON.stringify(payload),
        syncDirection: "write",
        syncStatus: "needs_review",
        createdAt: now,
        updatedAt: now
      })

      await insertOperations(db, {
        id: pmTaskId,
        projectId,
        sourceSystem: "compass",
        sourceRecordType: "staff_task",
        sourceRecordId: selectionId,
        sourceRecordNumber: projectTaskNumberFor(taskRows.length),
        title: `Review unavailable selection: ${existing.name}`,
        description:
          "Confirm impact of the unavailable finish selection and determine whether a change order is required.",
        status: "open",
        priority: "high",
        assigneeType: "internal",
        assigneeName: project?.projectManager ?? "Project Manager",
        costCode: existing.costCode,
        sageJobId: project?.sageJobId ?? null,
        sageJobNumber: project?.sageJobNumber ?? null,
        sageCostCode: existing.costCode,
        sageWriteStatus: "not_ready",
        sagePayloadJson: JSON.stringify({
          ...payload,
          taskRole: "project_manager",
          linkedUnavailableReviewId: reviewId
        }),
        syncDirection: "write",
        syncStatus: "compass_only",
        createdAt: now,
        updatedAt: now
      })

      await insertOperations(db, {
        id: adminTaskId,
        projectId,
        sourceSystem: "compass",
        sourceRecordType: "staff_task",
        sourceRecordId: selectionId,
        sourceRecordNumber: projectTaskNumberFor(taskRows.length + 1),
        title: `Request alternate selection: ${existing.name}`,
        description:
          "Coordinate with the owner for an alternate selection and notify affected subs/suppliers once approved.",
        status: "open",
        priority: "high",
        assigneeType: "internal",
        assigneeName: "Project Administrator",
        costCode: existing.costCode,
        sageJobId: project?.sageJobId ?? null,
        sageJobNumber: project?.sageJobNumber ?? null,
        sageCostCode: existing.costCode,
        sageWriteStatus: "not_ready",
        sagePayloadJson: JSON.stringify({
          ...payload,
          taskRole: "project_administrator",
          linkedUnavailableReviewId: reviewId
        }),
        syncDirection: "write",
        syncStatus: "compass_only",
        createdAt: now,
        updatedAt: now
      })
    }

    revalidatePath(`/dashboard/projects/${projectId}/selections`)
    revalidatePath(`/dashboard/projects/${projectId}`)
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update selection"
    }
  }
}

export async function deleteProjectSelection(
  projectId: string,
  selectionId: string
): Promise<ActionResult> {
  try {
    const { db, user } = await staffSelectionContext(projectId, "update")
    await requireFeaturePermission(user, "finish-selections", "delete")
    const [existing] = await db
      .select({
        id: projectFinishSelections.id,
        status: projectFinishSelections.status,
        ownerApproved: projectFinishSelections.ownerApproved
      })
      .from(projectFinishSelections)
      .where(
        and(
          eq(projectFinishSelections.id, selectionId),
          eq(projectFinishSelections.projectId, projectId)
        )
      )
      .limit(1)

    if (!existing) {
      return { success: false, error: "Selection not found." }
    }

    if (existing.ownerApproved || existing.status === "approved") {
      return {
        success: false,
        error:
          "Approved selections cannot be deleted. Change the selection status or create a change review instead."
      }
    }

    const deleted = await deleteFinishSelectionsReturningIds(
      db,
      and(
        eq(projectFinishSelections.id, selectionId),
        eq(projectFinishSelections.projectId, projectId),
        selectionDeletionAllowed(selectionId)
      )
    )
    if (!deleted.length) return {success:false,error:"Unpublish the decision and remove procurement links before deleting. Selections with owner approval or request history must be retained."}

    revalidatePath(`/dashboard/projects/${projectId}/selections`)
    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/preview/owner`)
    return { success: true, id: selectionId }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete selection"
    }
  }
}
