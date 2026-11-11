import { isNull, type SQL } from "drizzle-orm"

import { projectEstimates } from "@/db/schema-estimates"
import type { EstimateMode } from "@/lib/estimates/estimate-modes"

/*
 * A job's estimates fall into separate families: the contract estimate's
 * versions, each change order's estimate versions, and each phase proposal's
 * estimate versions. Only contract estimates build the contract budget.
 */

/** Conditions that select contract estimates (not change-order or phase estimates). */
export function contractEstimateConditions(): readonly SQL[] {
  return [isNull(projectEstimates.changeOrderId), isNull(projectEstimates.phaseProposalId)]
}

export function isContractEstimate(estimate: {
  readonly changeOrderId: string | null
  readonly phaseProposalId: string | null
}): boolean {
  return !estimate.changeOrderId && !estimate.phaseProposalId
}

/** Versions of one estimate share this key. */
export function estimateFamilyKey(estimate: {
  readonly changeOrderId: string | null
  readonly phaseProposalId: string | null
}): string {
  if (estimate.changeOrderId) return `change-order:${estimate.changeOrderId}`
  if (estimate.phaseProposalId) return `phase:${estimate.phaseProposalId}`
  return "contract"
}

/**
 * Why a copy into a job may not start a new draft estimate, or null when it
 * may. On one-contract-estimate jobs a new draft would be a new version that
 * replaces the contract, so added scope goes in the open draft or a change order.
 */
export function newDraftBlockedReason(
  mode: EstimateMode,
  estimates: readonly { readonly changeOrderId: string | null; readonly phaseProposalId: string | null; readonly status: string }[],
): string | null {
  if (mode !== "single") return null
  const contract = estimates.filter((estimate) => isContractEstimate(estimate) && estimate.status !== "void" && estimate.status !== "superseded")
  if (contract.length === 0) return null
  return contract.some((estimate) => estimate.status === "accepted")
    ? "This job's contract estimate is accepted. Start a change order estimate on the job and copy into that."
    : "This job already has a contract estimate. Copy into its open draft."
}
