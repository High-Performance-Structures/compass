"use server"

import { revalidatePath } from "next/cache"

import { actionFailure, errorMessage, type ActionResult } from "@/lib/action-result"
import { replaceLockedSelection } from "@/lib/domain/selections/replacement"
import { projectContext } from "@/lib/server/action-context"
import type { SelectionReplacementReason } from "@/lib/domain/selections/statuses"

/*
 * Staff actions for a selection that doesn't change in place
 * (src/lib/domain/selections/locks.ts): "Replace installed item", "Owner
 * changed selection after approval", "Owner changed selection after
 * purchase" and "Supplier couldn't fill". Each makes a new selection that
 * replaces the old one (kept on record) and a to-do to write its change order.
 */

export type SelectionReplacementDone = {
  readonly selectionId: string
  /** The to-do to write its change order (null when one is already open). */
  readonly todoId: string | null
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
      actor: user,
    })
    if (!result.ok) return actionFailure(result.error)
    revalidatePath(`/dashboard/projects/${projectId}/selections`)
    revalidatePath(`/dashboard/projects/${projectId}/todos`)
    return { success: true, data: { selectionId: result.selectionId, todoId: result.todoId } }
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

/** The owner changed their mind after the selection was approved (not yet ordered or installed); the new product may be picked now or later. */
export async function ownerChangedSelectionAfterApproval(
  projectId: string,
  selectionId: string,
  choiceId: string | null,
  note: string | null,
): Promise<ActionResult<SelectionReplacementDone>> {
  return replace(projectId, selectionId, "owner_changed_after_approval", choiceId, note)
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
