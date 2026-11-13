/**
 * A replacement selection's change order is its owner signature
 * (replacement.ts): when that change order is executed (signed, or its
 * acceptance recorded), the replacement becomes Approved (signed) and staff
 * get its "Order" to-do. Called after every change-order execution; it does
 * nothing for other change orders and is safe to call twice.
 */
import { and, eq, inArray } from "drizzle-orm"

import { projectChangeOrders, projectFinishSelections } from "@/db/schema"
import type { Db } from "@/lib/server/action-context"

import { EXECUTED_CHANGE_ORDER_STATUSES } from "./lock-read"
import { ensureSelectionTodo } from "./selection-todos"
import { updateFinishSelectionsWithEventStatement } from "./store"

export async function applyExecutedReplacementChangeOrder(
  db: Db,
  input: { readonly projectId: string; readonly changeOrderId: string; readonly actorId: string | null },
): Promise<boolean> {
  try {
    const order = await db
      .select({ selectionId: projectChangeOrders.sourceRecordId })
      .from(projectChangeOrders)
      .where(
        and(
          eq(projectChangeOrders.id, input.changeOrderId),
          eq(projectChangeOrders.projectId, input.projectId),
          eq(projectChangeOrders.sourceType, "selection_replacement"),
          inArray(projectChangeOrders.status, [...EXECUTED_CHANGE_ORDER_STATUSES]),
        ),
      )
      .get()
    const selectionId = order?.selectionId
    if (!selectionId) return false
    const now = new Date().toISOString()
    // Once: only while the owner's approval isn't recorded yet. The status
    // moves as a signature does (never back from ordered or installed).
    const [result] = await db.batch([
      updateFinishSelectionsWithEventStatement(
        db,
        and(eq(projectFinishSelections.id, selectionId), eq(projectFinishSelections.projectId, input.projectId), eq(projectFinishSelections.ownerApproved, false)),
        "owner_sign",
        { ownerApproved: true, approvedBy: null, approvedAt: now, updatedAt: now },
      ),
    ])
    if (result.meta.changes === 0) return false
    const row = await db
      .select({ name: projectFinishSelections.name, status: projectFinishSelections.status })
      .from(projectFinishSelections)
      .where(eq(projectFinishSelections.id, selectionId))
      .get()
    if (row?.status === "approved") {
      await ensureSelectionTodo(db, { projectId: input.projectId, selectionId, selectionName: row.name, step: "order", actorId: input.actorId, now })
    }
    return true
  } catch (error) {
    // The change order stands; staff can still set the selection by hand.
    console.error("[selections] replacement approval after its change order failed", error)
    return false
  }
}
