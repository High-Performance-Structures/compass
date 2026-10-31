"use server"

import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { saveEstimateTextTemplateLibraryItem } from "@/app/actions/estimate-text-templates"
import { createDriveUploadSession as getUploadSessionUrl } from "@/lib/domain/documents/drive-session"
import { projectEstimates } from "@/db/schema-estimates"
import {
  acceptanceUploadTarget,
  contractVersionAcceptancePreview,
  recordManualEstimateAcceptance,
} from "@/lib/domain/estimates/acceptance"
import {
  estimateAccess,
  estimateSourceForRecordCopy,
  requireEditableEstimate,
  revalidateEstimate,
} from "@/lib/domain/estimates/access"
import {
  createProjectEstimateDraftCommand,
  deleteProjectEstimateLineCommand,
  editEstimate,
  estimateFailure,
  saveProjectEstimateLineCommand,
} from "@/lib/domain/estimates/commands"
import { saveEstimateLineCostItem, setEstimateLineCostItemRemoved } from "@/lib/domain/estimates/cost-items"
import {
  createChangeOrderEstimate,
  deletableEstimateDraft,
  duplicateEstimate,
  recordEstimateDraftDeleted,
  type EstimateCopyDestination,
} from "@/lib/domain/estimates/drafts"
import {
  addEstimateBasisDocument,
  deleteEstimateBasisDocument,
  saveEstimatePhaseDescription,
  setEstimateAcknowledgements,
  setEstimateClientReportMode,
  updateEstimateHeader,
} from "@/lib/domain/estimates/header"
import {
  importBuildertrendExport,
  importEstimateFromGoogleSheet,
  importPlanSwiftLines,
} from "@/lib/domain/estimates/imports"
import {
  applyEstimateLineMarkup,
  updateEstimateBuilderFee,
} from "@/lib/domain/estimates/lines"
import { markEstimateSentOutsideCompass, prepareEstimateForClientSignature } from "@/lib/domain/estimates/signature"
import { deleteEstimatesStatement } from "@/lib/domain/estimates/store"
import { rfqBidImportsForEstimatesDeleteQueries } from "@/lib/domain/operations/store"
import type {
  ContractVersionAcceptancePreview,
  ProjectEstimateActionResult,
  ProjectEstimateBasisInput,
  ProjectEstimateBuilderFeeInput,
  ProjectEstimateBuildertrendImportInput,
  ProjectEstimateFoxitPreparationResult,
  ProjectEstimateHeaderInput,
  ProjectEstimateImportActionResult,
  ProjectEstimateLineCostItemInput,
  ProjectEstimateLineInput,
  ProjectEstimateManualAcceptanceInput,
  ProjectEstimatePlanSwiftImportInput,
  ProjectEstimatePlanSwiftImportResult,
  ProjectEstimateUploadSessionResult,
  ProjectEstimateVersionComparison,
  ProjectEstimateWorkspace,
} from "@/lib/domain/estimates/types"
import { loadProjectEstimateVersionComparison, loadProjectEstimateWorkspace } from "@/lib/domain/estimates/workspace"
import { getCloudflareContext } from "@/lib/db"
import { verifyRecordCopyToken } from "@/lib/paper-trail/print-token"
import { can, requirePermission } from "@/lib/permissions"
import { isInternalStaffRole } from "@/lib/user-roles"

/*
 * Estimate workspace actions. Each one checks estimate access, calls the
 * estimates domain module (src/lib/domain/estimates), revalidates the pages
 * and returns the result. The domain module owns the rules and the writes.
 */

export type {
  ContractVersionAcceptancePreview,
  ProjectEstimateActionResult,
  ProjectEstimateCostCodeOption,
  ProjectEstimateLineCostItem,
  ProjectEstimateLineInput,
  ProjectEstimateLineItem,
  ProjectEstimateSigner,
  ProjectEstimateSignerOption,
  ProjectEstimateSummary,
  ProjectEstimateTaxOption,
  ProjectEstimateTermsOption,
  ProjectEstimateVersionComparison,
  ProjectEstimateWorkspace,
} from "@/lib/domain/estimates/types"

const failure = estimateFailure

export async function getProjectEstimateWorkspace(
  projectId: string,
  estimateId?: string
): Promise<ProjectEstimateWorkspace> {
  const access = await estimateAccess(projectId, false)
  return loadProjectEstimateWorkspace(access, projectId, estimateId, {
    canEdit: isInternalStaffRole(access.user.role),
    canDelete: can(access.user, "budget", "delete"),
  })
}

/**
 * The estimate report data for the project paper trail's record-copy page.
 * Callable only with a valid single-record pass for this estimate; the copy
 * is read-only, so edit and delete controls are off.
 */
export async function getEstimateWorkspaceForRecordCopy(
  token: string
): Promise<ProjectEstimateWorkspace | null> {
  const { env } = await getCloudflareContext()
  const grant = await verifyRecordCopyToken(env, token)
  if (!grant || grant.recordType !== "estimate") return null
  const source = await estimateSourceForRecordCopy(env, grant.projectId)
  if (!source) return null
  const workspace = await loadProjectEstimateWorkspace(source, grant.projectId, grant.recordId, {
    canEdit: false,
    canDelete: false,
  })
  // Never fall back to another estimate when the requested one is gone.
  return workspace.activeEstimate?.id === grant.recordId ? workspace : null
}

export async function createProjectEstimateDraft(
  projectId: string
): Promise<ProjectEstimateActionResult> {
  return createProjectEstimateDraftCommand(projectId)
}

export async function createChangeOrderEstimateDraft(
  projectId: string,
  changeOrderId: string,
  /** Contract assemblies this change adds to or reduces. */
  contractAssemblyIds: readonly string[] = []
): Promise<ProjectEstimateActionResult> {
  try {
    const access = await estimateAccess(projectId, true)
    const { id, created } = await createChangeOrderEstimate(access, projectId, changeOrderId, contractAssemblyIds)
    if (created) {
      revalidateEstimate(projectId)
      revalidatePath(`/dashboard/projects/${projectId}/change-orders/${changeOrderId}`)
    }
    return { success: true, id }
  } catch (error) {
    return failure(error, "Unable to start the change-order estimate.")
  }
}

export async function deleteProjectEstimateDraft(
  projectId: string,
  estimateId: string
): Promise<ProjectEstimateActionResult> {
  try {
    const access = await estimateAccess(projectId, true)
    requirePermission(access.user, "budget", "delete")
    const estimate = await deletableEstimateDraft(access, projectId, estimateId)

    // Imported RFQ provenance is intentionally removed with the draft so the
    // approved bid can be imported into a replacement estimate later. The
    // RFQ tables belong to the RFQ area; the estimate goes through its store.
    const deletionResults = await access.db.batch([
      ...rfqBidImportsForEstimatesDeleteQueries(access.db, projectId, [estimateId]),
      deleteEstimatesStatement(
        access.db,
        and(
          eq(projectEstimates.id, estimateId),
          eq(projectEstimates.projectId, projectId),
          eq(projectEstimates.status, "draft")
        )
      ),
    ])
    const estimateDeletion = deletionResults[2]
    if (!estimateDeletion || (estimateDeletion.meta.changes ?? 0) !== 1) {
      throw new Error("The estimate changed before it could be deleted. Refresh and try again.")
    }
    await recordEstimateDraftDeleted(access, projectId, estimate)

    revalidateEstimate(projectId)
    revalidatePath(`/dashboard/projects/${projectId}/rfqs`)
    return { success: true, id: estimate.id }
  } catch (error) {
    return failure(error, "Unable to delete the estimate draft.")
  }
}

export async function duplicateProjectEstimate(
  projectId: string,
  sourceEstimateId: string,
  destination?: EstimateCopyDestination
): Promise<ProjectEstimateActionResult> {
  try {
    const access = await estimateAccess(projectId, true)
    const { id, destinationProjectId } = await duplicateEstimate(access, projectId, sourceEstimateId, destination)
    revalidateEstimate(destinationProjectId)
    return { success: true, id }
  } catch (error) {
    return failure(error, "Unable to duplicate the estimate.")
  }
}

export async function getProjectEstimateVersionComparison(
  projectId: string,
  baseEstimateId?: string,
  revisedEstimateId?: string
): Promise<ProjectEstimateVersionComparison> {
  const access = await estimateAccess(projectId, false)
  return loadProjectEstimateVersionComparison(access, projectId, baseEstimateId, revisedEstimateId)
}

export async function updateProjectEstimateHeader(
  projectId: string,
  estimateId: string,
  input: ProjectEstimateHeaderInput
): Promise<ProjectEstimateActionResult> {
  return editEstimate(projectId, estimateId, "Unable to save estimate.", async (access) => {
    await updateEstimateHeader(access, projectId, estimateId, input)
    return estimateId
  })
}

export async function setProjectEstimateClientReportMode(
  projectId: string,
  estimateId: string,
  mode: string,
  showAssemblyBuilderFee?: boolean,
  showCostBreakdowns?: boolean
): Promise<ProjectEstimateActionResult> {
  return editEstimate(projectId, estimateId, "Unable to save the client report view.", async (access) => {
    await setEstimateClientReportMode(access, estimateId, mode, showAssemblyBuilderFee, showCostBreakdowns)
    return estimateId
  })
}

export async function saveProjectEstimatePhaseDescription(
  projectId: string,
  estimateId: string,
  input: {
    readonly divisionCode: string | null
    readonly description: string | null
  }
): Promise<ProjectEstimateActionResult> {
  return editEstimate(projectId, estimateId, "Unable to save the phase description.", async (access) => {
    await saveEstimatePhaseDescription(access, projectId, estimateId, input)
    return estimateId
  })
}

export async function setProjectEstimateAcknowledgements(
  projectId: string,
  estimateId: string,
  templateIds: readonly string[]
): Promise<ProjectEstimateActionResult> {
  return editEstimate(projectId, estimateId, "Unable to save acknowledgements.", async (access) => {
    await setEstimateAcknowledgements(access, projectId, estimateId, templateIds)
    return estimateId
  })
}

export async function saveEstimateTextTemplate(
  projectId: string,
  input: {
    readonly name: string | null
    readonly templateType: string | null
    readonly body: string | null
  }
): Promise<ProjectEstimateActionResult> {
  try {
    const access = await estimateAccess(projectId, true)
    const result = await saveEstimateTextTemplateLibraryItem({
      templateId: null,
      name: input.name,
      departmentCode: access.department,
      templateType: input.templateType,
      body: input.body,
    })
    if (!result.success) return result
    revalidateEstimate(projectId)
    return { success: true, id: result.id }
  } catch (error) {
    return failure(error, "Unable to save the estimate text template.")
  }
}

export async function importProjectEstimateFromGoogleSheet(
  projectId: string,
  estimateId: string
): Promise<ProjectEstimateImportActionResult> {
  try {
    const access = await estimateAccess(projectId, true)
    const estimate = await requireEditableEstimate(access.db, projectId, estimateId)
    const imported = await importEstimateFromGoogleSheet(access, projectId, estimate)
    revalidateEstimate(projectId)
    return { success: true, id: estimateId, ...imported }
  } catch (error) {
    return failure(error, "Unable to import source CSI.")
  }
}

export async function importPlanSwiftEstimateLines(
  projectId: string,
  estimateId: string,
  input: ProjectEstimatePlanSwiftImportInput
): Promise<ProjectEstimatePlanSwiftImportResult> {
  try {
    const access = await estimateAccess(projectId, true)
    const estimate = await requireEditableEstimate(access.db, projectId, estimateId)
    const imported = await importPlanSwiftLines(access, projectId, estimate, input)
    revalidateEstimate(projectId)
    return { success: true, id: estimateId, ...imported }
  } catch (error) {
    return failure(error, "Unable to import the PlanSwift workbook.")
  }
}

/** Imports a Buildertrend estimate export into a draft estimate. */
export async function importBuildertrendEstimateExport(
  projectId: string,
  estimateId: string,
  input: ProjectEstimateBuildertrendImportInput
): Promise<ProjectEstimatePlanSwiftImportResult> {
  try {
    const access = await estimateAccess(projectId, true)
    const estimate = await requireEditableEstimate(access.db, projectId, estimateId)
    const imported = await importBuildertrendExport(access, projectId, estimate, input)
    revalidateEstimate(projectId)
    return { success: true, id: estimateId, ...imported }
  } catch (error) {
    return failure(error, "Unable to import the Buildertrend estimate.")
  }
}

export async function saveProjectEstimateLine(
  projectId: string,
  estimateId: string,
  lineId: string | null,
  input: ProjectEstimateLineInput
): Promise<ProjectEstimateActionResult> {
  return saveProjectEstimateLineCommand(projectId, estimateId, lineId, input)
}

export async function saveProjectEstimateLineCostItem(
  projectId: string,
  estimateId: string,
  lineId: string,
  costItemId: string | null,
  input: ProjectEstimateLineCostItemInput
): Promise<ProjectEstimateActionResult> {
  try {
    const access = await estimateAccess(projectId, true)
    const estimate = await requireEditableEstimate(access.db, projectId, estimateId)
    const id = await saveEstimateLineCostItem(access, projectId, estimate, lineId, costItemId, input)
    revalidateEstimate(projectId)
    return { success: true, id }
  } catch (error) {
    return failure(error, "Unable to save the line cost item.")
  }
}

export async function deleteProjectEstimateLineCostItem(
  projectId: string,
  estimateId: string,
  lineId: string,
  costItemId: string
): Promise<ProjectEstimateActionResult> {
  return editEstimate(projectId, estimateId, "Unable to delete the line cost item.", async (access) => {
    await setEstimateLineCostItemRemoved(access, { projectId, estimateId, lineId, costItemId, remove: true })
    return costItemId
  })
}

export async function restoreProjectEstimateLineCostItem(
  projectId: string,
  estimateId: string,
  lineId: string,
  costItemId: string
): Promise<ProjectEstimateActionResult> {
  return editEstimate(projectId, estimateId, "Unable to restore the line cost item.", async (access) => {
    await setEstimateLineCostItemRemoved(access, { projectId, estimateId, lineId, costItemId, remove: false })
    return costItemId
  })
}

export async function applyProjectEstimateLineMarkup(
  projectId: string,
  estimateId: string,
  markupPercent: number | null
): Promise<ProjectEstimateActionResult> {
  return editEstimate(projectId, estimateId, "Unable to apply line markup.", async (access) => {
    await applyEstimateLineMarkup(access, projectId, estimateId, markupPercent)
    return estimateId
  })
}

export async function updateProjectEstimateBuilderFee(
  projectId: string,
  estimateId: string,
  input: ProjectEstimateBuilderFeeInput
): Promise<ProjectEstimateActionResult> {
  return editEstimate(projectId, estimateId, "Unable to update the builder fee.", async (access) => {
    await updateEstimateBuilderFee(access, estimateId, input)
    return estimateId
  })
}

export async function deleteProjectEstimateLine(
  projectId: string,
  estimateId: string,
  lineId: string
): Promise<ProjectEstimateActionResult> {
  return deleteProjectEstimateLineCommand(projectId, estimateId, lineId)
}

export async function addProjectEstimateBasisDocument(
  projectId: string,
  estimateId: string,
  input: ProjectEstimateBasisInput
): Promise<ProjectEstimateActionResult> {
  return editEstimate(projectId, estimateId, "Unable to add basis document.", (access) =>
    addEstimateBasisDocument(access, projectId, estimateId, input)
  )
}

export async function deleteProjectEstimateBasisDocument(
  projectId: string,
  estimateId: string,
  documentId: string
): Promise<ProjectEstimateActionResult> {
  return editEstimate(projectId, estimateId, "Unable to remove the estimate basis document.", async (access) => {
    await deleteEstimateBasisDocument(access, projectId, estimateId, documentId)
    return documentId
  })
}

export async function prepareProjectEstimateForClientSignature(
  projectId: string,
  estimateId: string
): Promise<ProjectEstimateFoxitPreparationResult> {
  try {
    const access = await estimateAccess(projectId, true)
    const estimate = await requireEditableEstimate(access.db, projectId, estimateId)
    const embeddedSessionUrl = await prepareEstimateForClientSignature(access, projectId, estimate)
    revalidateEstimate(projectId)
    return { success: true, id: estimateId, embeddedSessionUrl }
  } catch (error) {
    return failure(error, "Unable to prepare signature.")
  }
}

export async function markProjectEstimateSentOutsideCompass(
  projectId: string,
  estimateId: string
): Promise<ProjectEstimateActionResult> {
  try {
    const access = await estimateAccess(projectId, true)
    const estimate = await requireEditableEstimate(access.db, projectId, estimateId)
    await markEstimateSentOutsideCompass(access, estimate)
    revalidateEstimate(projectId)
    return { success: true, id: estimateId }
  } catch (error) {
    return failure(error, "Unable to freeze the estimate for outside signatures.")
  }
}

/** Revalidates the pages itself: a partial acceptance still changed data. */
export async function recordManualProjectEstimateAcceptance(
  projectId: string,
  estimateId: string,
  input: ProjectEstimateManualAcceptanceInput
): Promise<ProjectEstimateActionResult> {
  try {
    const access = await estimateAccess(projectId, true)
    return await recordManualEstimateAcceptance(access, projectId, estimateId, input)
  } catch (error) {
    return failure(error, "Unable to record manual estimate acceptance.")
  }
}

/**
 * What accepting this estimate would do to an existing contract: the
 * line-by-line differences, and whether it can replace the contract.
 */
export async function getContractVersionAcceptancePreview(
  projectId: string,
  estimateId: string
): Promise<
  | { readonly success: true; readonly preview: ContractVersionAcceptancePreview }
  | { readonly success: false; readonly error: string }
> {
  try {
    const access = await estimateAccess(projectId, true)
    const preview = await contractVersionAcceptancePreview(access, projectId, estimateId)
    return { success: true, preview }
  } catch (error) {
    return failure(error, "Unable to compare this version with the contract.")
  }
}

export async function getProjectEstimateAcceptanceUploadSessionUrl(
  projectId: string,
  fileName: string,
  mimeType: string
): Promise<ProjectEstimateUploadSessionResult> {
  try {
    const access = await estimateAccess(projectId, true)
    const target = await acceptanceUploadTarget(access, projectId, fileName, mimeType)
    return getUploadSessionUrl(target.fileName, target.mimeType, target.folderId)
  } catch (error) {
    return failure(error, "Unable to start the signed document upload.")
  }
}
