import { errorMessage } from "@/lib/action-result"
import {
  estimateAccess,
  requireEditableEstimate,
  revalidateEstimate,
  type EstimateAccess,
} from "@/lib/domain/estimates/access"
import { createEstimateDraft } from "@/lib/domain/estimates/drafts"
import { deleteEstimateLine, saveEstimateLine } from "@/lib/domain/estimates/lines"
import type {
  ProjectEstimateActionResult,
  ProjectEstimateLineInput,
} from "@/lib/domain/estimates/types"

/*
 * Estimate commands shared by the estimate workspace actions and the actions
 * that build estimates for other workflows (Nu-Tech orders, cross-project
 * copies). Each checks estimate edit access, runs the domain change and
 * revalidates the estimate pages, so every caller gets the same rules.
 */

export function estimateFailure(
  error: unknown,
  fallback: string,
): { readonly success: false; readonly error: string } {
  return { success: false, error: errorMessage(error, fallback) }
}

/** Runs an edit to an editable estimate and revalidates its pages. */
export async function editEstimate(
  projectId: string,
  estimateId: string,
  fallback: string,
  edit: (access: EstimateAccess) => Promise<string>,
): Promise<ProjectEstimateActionResult> {
  try {
    const access = await estimateAccess(projectId, true)
    await requireEditableEstimate(access.db, projectId, estimateId)
    const id = await edit(access)
    revalidateEstimate(projectId)
    return { success: true, id }
  } catch (error) {
    return estimateFailure(error, fallback)
  }
}

export async function createProjectEstimateDraftCommand(
  projectId: string,
): Promise<ProjectEstimateActionResult> {
  try {
    const access = await estimateAccess(projectId, true)
    const id = await createEstimateDraft(access, projectId)
    revalidateEstimate(projectId)
    return { success: true, id }
  } catch (error) {
    return estimateFailure(error, "Unable to create estimate.")
  }
}

export async function saveProjectEstimateLineCommand(
  projectId: string,
  estimateId: string,
  lineId: string | null,
  input: ProjectEstimateLineInput,
): Promise<ProjectEstimateActionResult> {
  try {
    const access = await estimateAccess(projectId, true)
    const estimate = await requireEditableEstimate(access.db, projectId, estimateId)
    const id = await saveEstimateLine(access, projectId, estimate, lineId, input)
    revalidateEstimate(projectId)
    return { success: true, id }
  } catch (error) {
    return estimateFailure(error, "Unable to save estimate line.")
  }
}

export async function deleteProjectEstimateLineCommand(
  projectId: string,
  estimateId: string,
  lineId: string,
): Promise<ProjectEstimateActionResult> {
  return editEstimate(projectId, estimateId, "Unable to delete estimate line.", async (access) => {
    await deleteEstimateLine(access, estimateId, lineId)
    return lineId
  })
}
