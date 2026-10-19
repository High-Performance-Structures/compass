import { isNull, type SQL } from "drizzle-orm"

import { projectEstimates } from "@/db/schema-estimates"

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
