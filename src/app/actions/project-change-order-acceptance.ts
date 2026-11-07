"use server"

import { revalidatePath } from "next/cache"

import type { ChangeOrderCompletionActionResult, ChangeOrderManualAcceptanceInput } from "@/lib/change-orders/types"
import { recordChangeOrderManualAcceptance } from "@/lib/domain/estimates/change-order-acceptance"
import { isInternalStaffRole } from "@/lib/user-roles"
import { projectContext } from "@/lib/server/action-context"

/**
 * Records an owner's acceptance that came by email, text or in person and
 * executes the change order: written approval (evidence saved as the
 * executed document) or a staff sign-off. Staff change-order approvers only;
 * the company's Change-order acceptance settings decide when a sign-off is allowed.
 */
export async function recordProjectChangeOrderAcceptance(
  projectId: string,
  changeOrderId: string,
  input: ChangeOrderManualAcceptanceInput
): Promise<ChangeOrderCompletionActionResult> {
  try {
    const context = await projectContext(projectId, {
      scope: "organization",
      feature: "change-orders",
      action: "approve",
      mutation: true,
    })
    if (!context.success) return context
    const { db, user, organizationId } = context.data
    if (!isInternalStaffRole(user.role)) {
      return { success: false, error: "Change-order approval permission is required to record acceptance." }
    }
    const result = await recordChangeOrderManualAcceptance({
      db,
      organizationId,
      projectId,
      changeOrderId,
      user,
      canApprove: true,
      acceptance: input,
    })
    if (!result.success) return result
    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/change-orders`)
    revalidatePath(`/dashboard/projects/${projectId}/budget`)
    revalidatePath(`/preview/projects/${projectId}/owner/change-orders`)
    return { success: true, id: changeOrderId, budgetNote: result.budgetNote }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to record the change order's acceptance",
    }
  }
}
