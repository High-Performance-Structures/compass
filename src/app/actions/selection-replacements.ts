"use server"

import { revalidatePath } from "next/cache"

import { actionFailure, errorMessage, type ActionResult } from "@/lib/action-result"
import { replaceLockedSelection, startReplacementChangeOrder } from "@/lib/domain/selections/replacement"
import { repriceReplacementChangeOrder } from "@/lib/domain/selections/replacement-pricing"
import { canFeature, requireFeaturePermission } from "@/lib/permission-enforcement"
import { projectContext } from "@/lib/server/action-context"
import type { SelectionReplacementReason } from "@/lib/domain/selections/statuses"

/*
 * Staff actions for a locked selection (src/lib/domain/selections/locks.ts):
 * "Replace installed item" and "Owner changed selection after purchase".
 * Each makes a new selection that replaces the old one (kept on record) and
 * a draft change order for it.
 */

export type SelectionReplacementDone = {
  readonly selectionId: string
  readonly changeOrderId: string | null
  readonly changeOrderNumber: string | null
  /** Set when the replacement saved but its change order didn't. */
  readonly changeOrderError: string | null
}

/** Staff selections access for a write; refused for the read-only demo account and company. */
async function writeContext(projectId: string) {
  const context = await projectContext(projectId, { scope: "organization", feature: "finish-selections", action: "update", mutation: true })
  if (!context.success) throw new Error(context.error)
  const { organizationId } = context.data
  if (!organizationId) throw new Error("No active organization")
  return { ...context.data, organizationId }
}

async function replace(
  projectId: string,
  selectionId: string,
  reason: SelectionReplacementReason,
  choiceId: string | null,
  note: string | null,
): Promise<ActionResult<SelectionReplacementDone>> {
  try {
    const { db, user, organizationId } = await writeContext(projectId)
    const result = await replaceLockedSelection(db, {
      projectId,
      organizationId,
      selectionId,
      reason,
      choiceId,
      note,
      actor: { ...user, name: user.displayName ?? user.email },
      canCreateChangeOrder: await canFeature(user, "change-orders", "create"),
    })
    if (!result.ok) return actionFailure(result.error)
    revalidatePath(`/dashboard/projects/${projectId}/selections`)
    revalidatePath(`/dashboard/projects/${projectId}/change-orders`)
    return {
      success: true,
      data: {
        selectionId: result.selectionId,
        changeOrderId: result.changeOrder?.id ?? null,
        changeOrderNumber: result.changeOrder?.number ?? null,
        changeOrderError: result.changeOrderError,
      },
    }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to replace the selection."))
  }
}

/** An installed item must be replaced with a different product (`choiceId`, one of the selection's other choices). */
export async function replaceInstalledSelection(
  projectId: string,
  selectionId: string,
  choiceId: string,
  note: string | null,
): Promise<ActionResult<SelectionReplacementDone>> {
  return replace(projectId, selectionId, "installed_replaced", choiceId, note)
}

/** The owner changed their mind after the selection was ordered; the new product may be picked now or later. */
export async function ownerChangedSelectionAfterPurchase(
  projectId: string,
  selectionId: string,
  choiceId: string | null,
  note: string | null,
): Promise<ActionResult<SelectionReplacementDone>> {
  return replace(projectId, selectionId, "owner_changed_after_purchase", choiceId, note)
}

/** The supplier couldn't fill an ordered selection (now Unavailable); the new product may be picked now or later. */
export async function supplierCouldntFillSelection(
  projectId: string,
  selectionId: string,
  choiceId: string | null,
  note: string | null,
): Promise<ActionResult<SelectionReplacementDone>> {
  return replace(projectId, selectionId, "supplier_couldnt_fill", choiceId, note)
}

/** Re-prices a replacement's draft change order for its current pick (after the owner picked, say). */
export async function updateReplacementChangeOrder(projectId: string, selectionId: string): Promise<ActionResult<{ readonly changeOrderNumber: string | null }>> {
  try {
    const { db, user } = await writeContext(projectId)
    await requireFeaturePermission(user, "change-orders", "update")
    const result = await repriceReplacementChangeOrder(db, { projectId, selectionId, by: { kind: "staff", actor: user, canUpdateChangeOrders: true } })
    if (result.kind === "skipped") return actionFailure(result.reason)
    revalidatePath(`/dashboard/projects/${projectId}/selections`)
    revalidatePath(`/dashboard/projects/${projectId}/change-orders`)
    return { success: true, data: { changeOrderNumber: result.kind === "repriced" ? result.changeOrderNumber : null } }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to update the change order."))
  }
}

/** Starts the draft change order for a replacement that has none. */
export async function createReplacementChangeOrder(
  projectId: string,
  selectionId: string,
): Promise<ActionResult<{ readonly changeOrderId: string; readonly changeOrderNumber: string }>> {
  try {
    const { db, user } = await writeContext(projectId)
    await requireFeaturePermission(user, "change-orders", "create")
    const result = await startReplacementChangeOrder(db, { projectId, selectionId, actor: { ...user, name: user.displayName ?? user.email } })
    if (!result.ok) return actionFailure(result.error)
    revalidatePath(`/dashboard/projects/${projectId}/selections`)
    revalidatePath(`/dashboard/projects/${projectId}/change-orders`)
    return { success: true, data: { changeOrderId: result.id, changeOrderNumber: result.number } }
  } catch (error) {
    return actionFailure(errorMessage(error, "Unable to create the change order."))
  }
}
