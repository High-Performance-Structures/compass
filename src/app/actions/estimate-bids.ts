"use server"

import { and, eq } from "drizzle-orm"

import { approveProjectRfqBid, importApprovedProjectRfqBid } from "@/app/actions/project-rfq-bids"
import { projectEstimateLines } from "@/db/schema-estimates"
import { estimateAccess, revalidateEstimate } from "@/lib/domain/estimates/access"
import { loadRfqAnswers } from "@/lib/domain/estimates/selected-trades"
import { bidsForCostCode, type LineBid } from "@/lib/estimates/line-bids"
import { canFeature } from "@/lib/permission-enforcement"
import { can } from "@/lib/permissions"
import { isInternalStaffRole } from "@/lib/user-roles"

type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }

export type EstimateLineBidsView = {
  readonly costCode: string
  readonly costCodeName: string
  readonly bids: readonly LineBid[]
  readonly canAccept: boolean
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

/** Every bid on this job that prices the line's cost code. */
export async function getEstimateLineBids(projectId: string, estimateId: string, lineId: string): Promise<Result<EstimateLineBidsView>> {
  try {
    const access = await estimateAccess(projectId, false)
    if (!isInternalStaffRole(access.user.role)) return { success: false, error: "Bids are for office staff." }
    const [line] = await access.db
      .select({ costCode: projectEstimateLines.costCode, costCodeName: projectEstimateLines.costCodeName })
      .from(projectEstimateLines)
      .where(and(eq(projectEstimateLines.id, lineId), eq(projectEstimateLines.estimateId, estimateId), eq(projectEstimateLines.projectId, projectId)))
      .limit(1)
    if (!line) return { success: false, error: "Estimate line not found." }
    const { rfqs, approvalByRfq, rfqByApproval, imports } = await loadRfqAnswers(access, projectId, estimateId)
    const bids = bidsForCostCode(
      line.costCode,
      rfqs.map((rfq) => ({
        ...rfq,
        approvalId: approvalByRfq.get(rfq.id) ?? null,
        importedLineNumbers: imports.filter((row) => rfqByApproval.get(row.approvalId) === rfq.id).map((row) => row.lineNumber),
      })),
    )
    const canAccept = (await canFeature(access.user, "rfqs", "approve")) && can(access.user, "budget", "update")
    return { success: true, data: { costCode: line.costCode, costCodeName: line.costCodeName, bids, canAccept } }
  } catch (error) {
    return { success: false, error: message(error, "Could not load the bids.") }
  }
}

/**
 * Accepts a bid for the chosen scope lines: approves it if it isn't yet, then
 * puts those prices into this estimate (filling lines waiting at $0, adding
 * the rest). The vendor joins the job's selected trades.
 */
export async function acceptEstimateBid(
  projectId: string,
  estimateId: string,
  rfqId: string,
  lineNumbers: readonly number[],
): Promise<Result<{ readonly lineCount: number }>> {
  try {
    const access = await estimateAccess(projectId, true)
    const chosen = [...new Set(lineNumbers)].filter((value) => Number.isInteger(value) && value > 0)
    if (chosen.length === 0) return { success: false, error: "Choose at least one cost code to accept." }
    const { approvalByRfq, imports } = await loadRfqAnswers(access, projectId, estimateId)
    let approvalId = approvalByRfq.get(rfqId) ?? null
    if (approvalId && imports.some((row) => row.approvalId === approvalId)) {
      return { success: false, error: "This bid is already in the estimate. Accept another vendor's bid for the remaining codes." }
    }
    if (!approvalId) {
      const approved = await approveProjectRfqBid(projectId, rfqId, "Accepted from the estimate's Bids window.")
      if (!approved.success) return { success: false, error: approved.error }
      approvalId = approved.id
    }
    const imported = await importApprovedProjectRfqBid(projectId, approvalId, estimateId, chosen)
    if (!imported.success) return { success: false, error: imported.error }
    revalidateEstimate(projectId)
    return { success: true, data: { lineCount: imported.lineCount ?? chosen.length } }
  } catch (error) {
    return { success: false, error: message(error, "Could not accept the bid.") }
  }
}

