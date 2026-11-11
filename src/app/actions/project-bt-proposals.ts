"use server"

import { desc, eq } from "drizzle-orm"

import { projectEstimates } from "@/db/schema-estimates"
import { recordActivityEvent } from "@/lib/activity-log"
import { btProposalImportRows } from "@/lib/buildertrend/lead-proposal-copy"
import {
  btProposalStaffContext,
  loadProjectBtProposal,
  loadProjectBtProposals,
  type BtProposalList,
} from "@/lib/buildertrend/lead-proposals-server"
import { createProjectEstimateDraftCommand } from "@/lib/domain/estimates/commands"
import { estimateAccess, requireEditableEstimate, revalidateEstimate } from "@/lib/domain/estimates/access"
import { importBuildertrendExport } from "@/lib/domain/estimates/imports"
import { deleteEstimates, updateEstimates } from "@/lib/domain/estimates/store"
import { newDraftBlockedReason } from "@/lib/estimates/estimate-family"
import { readEstimateMode } from "@/lib/estimates/numbering"
import { formatCents } from "@/lib/format"
import { recordSourceTag } from "@/lib/record-source"

/*
 * Buildertrend lead proposals on the Estimate page (staff only). Reading is
 * history; "Copy into a new draft estimate" starts a normal draft on the job
 * from the proposal's items through the Buildertrend estimate importer. The
 * Buildertrend record is never changed, and nothing is sent to Sage or anyone.
 */

export type ProjectBtProposalsResult =
  | ({ readonly success: true } & BtProposalList)
  | { readonly success: false; readonly error: string }

/** Internal history only. Never reuse this for an owner or vendor portal. */
export async function getProjectBtProposals(projectId: string): Promise<ProjectBtProposalsResult> {
  try {
    const context = await btProposalStaffContext(projectId, "read")
    return { success: true, ...(await loadProjectBtProposals(context, projectId)) }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Buildertrend proposals could not be loaded." }
  }
}

export type CopyBtProposalResult =
  | { readonly success: true; readonly estimateId: string; readonly estimateNumber: string; readonly lineCount: number }
  | { readonly success: false; readonly error: string }

/** Starts a draft estimate on this job from a Buildertrend proposal's items. */
export async function copyBtProposalToDraftEstimate(projectId: string, recordId: string): Promise<CopyBtProposalResult> {
  try {
    const context = await btProposalStaffContext(projectId, "copy")
    const found = await loadProjectBtProposal(context, projectId, recordId)
    if (!found) return { success: false, error: "That Buildertrend proposal is not available." }
    const rows = btProposalImportRows(found.proposal)
    if (rows.lines.length === 0) return { success: false, error: "This proposal has no line items to copy." }

    const access = await estimateAccess(projectId, true)
    const [mode, estimates] = await Promise.all([
      readEstimateMode(access.db, access.organizationId, access.department),
      access.db.select().from(projectEstimates).where(eq(projectEstimates.projectId, projectId)).orderBy(desc(projectEstimates.updatedAt)),
    ])
    if (newDraftBlockedReason(mode, estimates)) {
      return {
        success: false,
        error: "This job keeps one contract estimate and already has one, so a proposal can't start a new draft here. Add the scope to the open draft or a change order estimate.",
      }
    }

    const created = await createProjectEstimateDraftCommand(projectId)
    if (!created.success) return created
    const estimate = await requireEditableEstimate(access.db, projectId, created.id)
    let imported: { readonly lineCount: number; readonly totalCents: number }
    try {
      imported = await importBuildertrendExport(
        access,
        projectId,
        estimate,
        { sourceFileName: rows.sourceFileName, replaceExisting: true, lines: rows.lines, phases: rows.phases },
        { unmatchedCostCodes: "keep" },
      )
      const title = found.proposal.title.trim()
      if (title) await updateEstimates(access.db, eq(projectEstimates.id, estimate.id), { title: title.slice(0, 200) })
    } catch (error) {
      // Don't leave an empty draft behind when the lines can't be brought in.
      await deleteEstimates(access.db, eq(projectEstimates.id, estimate.id))
      throw error
    }

    await recordActivityEvent({
      db: access.db,
      organizationId: context.organizationId,
      projectId,
      actor: context.user,
      category: "financial",
      action: "estimate_copied_from_buildertrend_proposal",
      entityType: "project_estimate",
      entityId: estimate.id,
      summary: `Started draft estimate ${estimate.estimateNumber} from ${recordSourceTag("buildertrend")} proposal "${found.proposal.title}" (${imported.lineCount} ${imported.lineCount === 1 ? "item" : "items"}, ${formatCents(imported.totalCents)}). The proposal was not changed.`,
      metadata: { sourceRecordId: recordId, buildertrendProposalId: found.proposal.proposalId, lineCount: imported.lineCount },
    })
    revalidateEstimate(projectId)
    return { success: true, estimateId: estimate.id, estimateNumber: estimate.estimateNumber, lineCount: imported.lineCount }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to copy the proposal into a draft estimate." }
  }
}
