/*
 * Change order status writes (issue #1329): the only code that changes
 * project_change_orders.status, through the events of
 * ./change-order-machine.ts, written by ./store.ts (whose plain updates
 * refuse a status). Every move is compare-and-set on the status read.
 * No access rules here; callers check access first.
 */
import { and, eq, inArray, sql, type SQL } from "drizzle-orm"

import { projectChangeOrders } from "@/db/schema"
import { batchGuardStatement, isBatchGuardFailure } from "@/lib/d1-query"
import type { Db } from "@/lib/server/action-context"

import { changeOrderMachine, staffEventFor, type ChangeOrderEvent } from "./change-order-machine"
import type { ChangeOrderStatus } from "./statuses"
import { changeOrderWriteStatement, type ChangeOrderPatch, type Statement } from "./store"

type ChangeOrderMove = {
  readonly changeOrderId: string
  readonly projectId?: string
  readonly event: ChangeOrderEvent
  /** The status the caller read; any of the event's source statuses when omitted. */
  readonly expected?: string
  /** Other columns written with the status. */
  readonly values?: ChangeOrderPatch
  /** A further condition the move needs (on the change order or elsewhere). */
  readonly also?: SQL
}

function changeOrderMoveWhere(move: ChangeOrderMove): SQL | undefined {
  const rule = changeOrderMachine.transitions[move.event]
  const from: readonly ChangeOrderStatus[] = move.expected === undefined ? rule.from : rule.from.filter((state) => state === move.expected)
  if (from.length === 0) throw new Error(`${changeOrderMachine.name}: "${move.event}" is not allowed from "${move.expected ?? ""}".`)
  return and(
    eq(projectChangeOrders.id, move.changeOrderId),
    move.projectId ? eq(projectChangeOrders.projectId, move.projectId) : undefined,
    inArray(projectChangeOrders.status, [...from]),
    move.also,
  )
}

/**
 * A change order's status move through `event` of ./change-order-machine.ts,
 * compare-and-set: it lands only while the change order is still `expected`
 * and `also` holds, and is skipped otherwise while the rest of the batch
 * runs. For automatic moves that may simply not apply any more.
 */
export function changeOrderStatusStatement(db: Db, move: ChangeOrderMove): Statement {
  return changeOrderWriteStatement(db, changeOrderMoveWhere(move), { ...(move.values ?? {}), status: changeOrderMachine.transitions[move.event].to })
}

/**
 * The same move as the first two statements of the caller's batch: a guard
 * that fails the whole batch unless the move still applies, then the write.
 * Everything after them (lines, history) lands only with the move; a refused
 * batch shows as isBatchGuardFailure. Run follow-ups (Activity, a contract
 * budget rebuild) only after the batch.
 */
export function changeOrderMoveStatements(db: Db, move: ChangeOrderMove): readonly [Statement, Statement] {
  return [
    batchGuardStatement(db, sql`EXISTS (SELECT 1 FROM ${projectChangeOrders} WHERE ${changeOrderMoveWhere(move)})`, `change order ${move.event}`),
    changeOrderStatusStatement(db, move),
  ]
}

/**
 * A guard for a batch that edits a change order without moving it: fails
 * the batch unless the change order still has the status the caller read,
 * so an edit can't land on one executed or voided meanwhile.
 */
export function changeOrderStatusGuardStatement(
  db: Db,
  input: { readonly changeOrderId: string; readonly projectId?: string; readonly expected: string },
): Statement {
  const where = and(
    eq(projectChangeOrders.id, input.changeOrderId),
    input.projectId ? eq(projectChangeOrders.projectId, input.projectId) : undefined,
    // The stored value is compared as text (the caller read it from the row).
    sql`${projectChangeOrders.status} = ${input.expected}`,
  )
  return batchGuardStatement(db, sql`EXISTS (SELECT 1 FROM ${projectChangeOrders} WHERE ${where})`, "change order unchanged")
}

/**
 * The first statements of a batch that edits a change order a person saw as
 * `expected`: the staff move to `to` when the status changes, otherwise just
 * the guard. Null when staff can't pick `to` at all.
 */
export function changeOrderEditStatements(
  db: Db,
  input: { readonly changeOrderId: string; readonly projectId: string; readonly expected: ChangeOrderStatus; readonly to: ChangeOrderStatus },
): readonly [Statement, ...Statement[]] | null {
  const { changeOrderId, projectId, expected } = input
  if (input.to === expected) return [changeOrderStatusGuardStatement(db, { changeOrderId, projectId, expected })]
  const event = staffEventFor(input.to)
  return event ? changeOrderMoveStatements(db, { changeOrderId, projectId, event, expected }) : null
}

/** Runs a batch that starts with a guard; false (nothing written) when the guard refused it. */
export async function runGuardedChangeOrderBatch(db: Db, statements: readonly [Statement, ...Statement[]]): Promise<boolean> {
  try {
    await db.batch(statements)
    return true
  } catch (error) {
    if (isBatchGuardFailure(error)) return false
    throw error
  }
}
