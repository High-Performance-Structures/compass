"use server"

import { revalidatePath } from "next/cache"

import { actionFailure, errorMessage, type ActionResult } from "@/lib/action-result"
import { staffSelectionContext } from "@/lib/domain/selections/access"
import { replaceLockedSelection } from "@/lib/domain/selections/replacement"
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

async function replace(
  projectId: string,
  selectionId: string,
  reason: SelectionReplacementReason,
  choiceId: string | null,
  note: string | null,
): Promise<ActionResult<SelectionReplacementDone>> {
  try {
    const { db, user, organizationId } = await staffSelectionContext(projectId, "update")
    const result = await replaceLockedSelection(db, {
      projectId,
      organizationId,
      selectionId,
      reason,
      choiceId,
      note,
      actor: { ...user, name: user.displayName ?? user.email },
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
