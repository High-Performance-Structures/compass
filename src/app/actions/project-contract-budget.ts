"use server"

import { revalidatePath } from "next/cache"

import { rebuildProjectContractBudget } from "@/lib/financials/contract-budget-store"
import { moveDraftPayApplicationsToRevision } from "@/lib/financials/owner-pay-application-refresh"
import { projectContext } from "@/lib/server/action-context"
import { isInternalStaffRole } from "@/lib/user-roles"

export type ContractBudgetRefreshResult =
  | {
      readonly success: true
      readonly revisionNumber: number
      readonly changed: boolean
    }
  | { readonly success: false; readonly error: string }

/**
 * Rebuild the project's contract budget from its signed estimate and executed
 * change orders. When anything changed, a new revision becomes current and
 * draft pay applications move onto it, keeping the work already entered.
 * Nothing changes when the sources are the same as the current revision.
 * Office staff only.
 */
export async function refreshProjectContractBudget(projectId: string): Promise<ContractBudgetRefreshResult> {
  try {
    const context = await projectContext(projectId, {
      scope: "organization",
      feature: "budget",
      action: "update",
      mutation: true,
    })
    if (!context.success) return context
    const { db, user } = context.data
    if (!isInternalStaffRole(user.role)) {
      return { success: false, error: "Only office staff can rebuild the contract budget." }
    }
    const result = await rebuildProjectContractBudget({ db, projectId, actorUserId: user.id })
    if (!result.success) return result
    // A new current revision already moved the drafts; an unchanged one still
    // brings along any draft left on an older revision.
    if (!result.changed) {
      await moveDraftPayApplicationsToRevision(db, projectId, result.revisionId, new Date().toISOString())
    }
    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/financials`)
    revalidatePath(`/dashboard/projects/${projectId}/budget`)
    return { success: true, revisionNumber: result.revisionNumber, changed: result.changed }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to rebuild the contract budget.",
    }
  }
}
