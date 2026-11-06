"use server"

import { revalidatePath } from "next/cache"

import { activityActorName } from "@/lib/activity-log"
import type { ChangeOrderCompletionActionResult, ChangeOrderCompletionInput } from "@/lib/change-orders/types"
import { completeExecutedChangeOrder } from "@/lib/domain/estimates/change-order-completion"
import { isInternalStaffRole } from "@/lib/user-roles"
import { projectContext } from "@/lib/server/action-context"

/**
 * Splits an imported executed change order across cost codes and records its
 * execution date so it can revise the contract budget. Staff approvers only.
 */
export async function completeExecutedProjectChangeOrder(
  projectId: string,
  changeOrderId: string,
  input: ChangeOrderCompletionInput
): Promise<ChangeOrderCompletionActionResult> {
  try {
    const context = await projectContext(projectId, {
      scope: "organization",
      feature: "change-orders",
      action: "approve",
      mutation: true,
    })
    if (!context.success) return context
    const { db, user } = context.data
    if (!isInternalStaffRole(user.role)) {
      return { success: false, error: "Change-order approval permission is required to complete cost codes." }
    }
    const result = await completeExecutedChangeOrder({
      db,
      projectId,
      changeOrderId,
      actor: { id: user.id, name: activityActorName(user), role: user.role },
      lines: input.lines,
      executedOn: input.executedOn,
      reason: input.reason,
    })
    if (!result.success) return result
    revalidatePath(`/dashboard/projects/${projectId}/change-orders`)
    revalidatePath(`/dashboard/projects/${projectId}/budget`)
    return { success: true, id: changeOrderId, budgetNote: result.budgetNote }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to complete the change order's cost codes",
    }
  }
}
