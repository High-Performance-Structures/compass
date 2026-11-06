import { and, asc, eq } from "drizzle-orm"

import { projectChangeOrderLines, projectChangeOrders } from "@/db/schema"
import { projectContractBudgetAdjustments } from "@/db/schema-estimates"
import { loadProjectCostCodeChoices } from "@/lib/cost-codes/catalog-server"
import {
  changeOrderNeedsCompletion,
  planChangeOrderCompletion,
  type ChangeOrderCompletionLineInput,
} from "@/lib/domain/estimates/rules"
import {
  deleteChangeOrderLinesStatement,
  insertChangeOrderHistoryStatement,
  insertChangeOrderLineStatement,
  updateChangeOrdersStatement,
} from "@/lib/domain/estimates/store"
import { rebuildProjectContractBudget } from "@/lib/financials/contract-budget-store"
import type { Db } from "@/lib/server/action-context"

/*
 * Completing an imported executed change order: staff split its signed amount
 * across cost codes and record when it was executed, so it can revise the
 * contract budget. The amount, status and documents never change. Callers
 * check that the user may approve change orders on this project.
 */

export type ChangeOrderCompletionActor = {
  readonly id: string
  readonly name: string
  readonly role: string
}

export type ChangeOrderCompletionResult =
  | {
      readonly success: true
      /** Why the contract budget wasn't rebuilt, when it wasn't. */
      readonly budgetNote: string | null
    }
  | { readonly success: false; readonly error: string }

export async function completeExecutedChangeOrder(input: {
  readonly db: Db
  readonly projectId: string
  readonly changeOrderId: string
  readonly actor: ChangeOrderCompletionActor
  readonly lines: readonly ChangeOrderCompletionLineInput[]
  readonly executedOn: string
  readonly reason: string
}): Promise<ChangeOrderCompletionResult> {
  const { db, projectId, changeOrderId } = input
  const changeOrder = await db
    .select()
    .from(projectChangeOrders)
    .where(and(eq(projectChangeOrders.id, changeOrderId), eq(projectChangeOrders.projectId, projectId)))
    .get()
  if (!changeOrder) return { success: false, error: "Change order not found." }
  const [existingLines, budgetUse, costCodes] = await Promise.all([
    db
      .select()
      .from(projectChangeOrderLines)
      .where(eq(projectChangeOrderLines.changeOrderId, changeOrderId))
      .orderBy(asc(projectChangeOrderLines.lineNumber)),
    db
      .select({ id: projectContractBudgetAdjustments.id })
      .from(projectContractBudgetAdjustments)
      .where(eq(projectContractBudgetAdjustments.changeOrderId, changeOrderId))
      .limit(1),
    loadProjectCostCodeChoices(db, projectId),
  ])
  const needsCompletion = changeOrderNeedsCompletion({
    status: changeOrder.status,
    budgetTreatment: changeOrder.budgetTreatment,
    kind: changeOrder.changeOrderKind,
    executedAt: changeOrder.executedAt,
    lines: existingLines,
  })
  // A change order already in a contract budget revision is complete history.
  if (!needsCompletion || budgetUse.length > 0) {
    return { success: false, error: "This change order already has its cost codes and execution date." }
  }

  const now = new Date().toISOString()
  const plan = planChangeOrderCompletion({
    amountCents: changeOrder.amountCents,
    allowedCostCodes: new Set(costCodes.map((choice) => choice.code)),
    lines: input.lines,
    executedOn: changeOrder.executedAt ? changeOrder.executedAt.slice(0, 10) : input.executedOn,
    reason: input.reason,
    today: now.slice(0, 10),
  })
  if (!plan.success) return plan

  // A recorded execution date is kept; a missing one is set to noon UTC on the
  // chosen day so it reads as that date in every US time zone.
  const executedAt = changeOrder.executedAt ?? `${plan.executedOn}T12:00:00.000Z`
  await db.batch([
    deleteChangeOrderLinesStatement(db, eq(projectChangeOrderLines.changeOrderId, changeOrderId)),
    insertChangeOrderLineStatement(
      db,
      plan.lines.map((line, index) => ({
        id: crypto.randomUUID(),
        projectId,
        changeOrderId,
        lineNumber: index + 1,
        description: line.description,
        phaseCode: line.costCode.slice(0, 2),
        costCode: line.costCode,
        amountCents: line.amountCents,
        createdAt: now,
        updatedAt: now,
      }))
    ),
    updateChangeOrdersStatement(
      db,
      and(eq(projectChangeOrders.id, changeOrderId), eq(projectChangeOrders.projectId, projectId)),
      { executedAt, updatedAt: now }
    ),
    insertChangeOrderHistoryStatement(db, {
      id: crypto.randomUUID(),
      projectId,
      changeOrderId,
      eventType: "cost_codes_completed",
      fromStatus: changeOrder.status,
      toStatus: changeOrder.status,
      actorUserId: input.actor.id,
      actorName: input.actor.name,
      actorRole: input.actor.role,
      note: plan.reason,
      metadataJson: JSON.stringify({
        executedAt,
        previousExecutedAt: changeOrder.executedAt,
        previousLines: existingLines.map((line) => ({
          description: line.description,
          costCode: line.costCode,
          amountCents: line.amountCents,
        })),
        lines: plan.lines,
      }),
      createdAt: now,
    }),
  ])

  // The budget rebuild refuses while any executed change order is still
  // incomplete, so the last one completed is the one that updates the G703.
  const budget = await rebuildProjectContractBudget({ db, projectId, actorUserId: input.actor.id })
  return { success: true, budgetNote: budget.success ? null : budget.error }
}
