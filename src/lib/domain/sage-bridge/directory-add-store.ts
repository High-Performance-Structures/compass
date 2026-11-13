import { and, eq, inArray, sql, type SQL } from "drizzle-orm"
import type { SQLiteInsertValue } from "drizzle-orm/sqlite-core"

import { sageDirectoryAddRequests } from "@/db/schema-sage"
import type { Db } from "@/lib/server/action-context"

import { directoryAddMachine, type DirectoryAddEvent } from "./machines"

/*
 * The only writer of sage_directory_add_requests ("Request add to Sage").
 * Reads and the workflow live in src/lib/sage/directory-add-service.ts.
 * Every status change is an event of directoryAddMachine (./machines.ts),
 * written as compare-and-set on the event's source states.
 */

type AddRequestPatch = Partial<Omit<typeof sageDirectoryAddRequests.$inferInsert, "id" | "organizationId" | "requestedAt" | "status">>

/** Inserts a new request; it always starts pending. */
export function insertSageDirectoryAddRequest(
  db: Db,
  values: Omit<SQLiteInsertValue<typeof sageDirectoryAddRequests>, "status">
) {
  return db.insert(sageDirectoryAddRequests).values({ ...values, status: directoryAddMachine.initial })
}

/**
 * Moves the request through `event` with the other columns in `values`, only
 * while it is still in one of the event's source states; returns how many
 * rows changed (0 when someone else moved it first). `where` narrows the
 * fence further (the writer's request id, say).
 */
export async function moveSageDirectoryAddRequest(
  db: Db,
  input: {
    readonly id: string
    readonly organizationId: string
    readonly event: DirectoryAddEvent
    readonly values: AddRequestPatch
    readonly where?: SQL
  }
): Promise<number> {
  const rule = directoryAddMachine.transitions[input.event]
  const fence: SQL | undefined = and(
    eq(sageDirectoryAddRequests.id, input.id),
    eq(sageDirectoryAddRequests.organizationId, input.organizationId),
    inArray(sageDirectoryAddRequests.status, [...rule.from]),
    input.where
  )
  const result = await db.update(sageDirectoryAddRequests).set({ ...input.values, status: rule.to }).where(fence).run()
  return result.meta.changes
}

/**
 * Points a sent request at the writer request already there for it (no status
 * change), only while that writer request is still live or done (not
 * cancelled), checked in the same statement. True when it did.
 */
export async function relinkSageDirectoryAddOperation(
  db: Db,
  input: {
    readonly id: string; readonly organizationId: string; readonly fromOperationId: string; readonly toOperationId: string; readonly now: string
    /** The writer request's states it may be linked in (default: queued, running or succeeded). */
    readonly operationStatuses?: readonly ("queued" | "running" | "succeeded" | "failed")[]
  }
): Promise<boolean> {
  const statuses = input.operationStatuses ?? ["queued", "running", "succeeded"]
  const result = await db.update(sageDirectoryAddRequests)
    .set({ writeOperationId: input.toOperationId, errorMessage: null, updatedAt: input.now })
    .where(and(
      eq(sageDirectoryAddRequests.id, input.id),
      eq(sageDirectoryAddRequests.organizationId, input.organizationId),
      eq(sageDirectoryAddRequests.status, directoryAddMachine.transitions.send.to),
      eq(sageDirectoryAddRequests.writeOperationId, input.fromOperationId),
      sql`EXISTS (SELECT 1 FROM sage_client_project_write_operations op
        WHERE op.id = ${input.toOperationId} AND op.status IN (${sql.join(statuses.map((status) => sql`${status}`), sql`, `)}))`
    ))
    .run()
  return result.meta.changes === 1
}

/**
 * succeed / fail as a raw statement for the writer result's batch: the sent
 * request for `operationId`, only while `guard` (the result's success under
 * its lease) holds.
 */
export function sageDirectoryAddOutcomeStatement(
  database: D1Database,
  input: {
    readonly requestId: string
    readonly organizationId: string
    readonly operationId: string
    readonly event: "succeed" | "fail"
    readonly sageRecordId: string | null
    readonly sageRecordNumber: string | null
    readonly errorMessage: string | null
    readonly now: string
    readonly guard: { readonly sql: string; readonly binds: readonly unknown[] }
  }
): D1PreparedStatement {
  const { from, to } = directoryAddMachine.transitions[input.event]
  return database.prepare(
    `UPDATE sage_directory_add_requests
       SET status = ?, sage_record_id = ?, sage_record_number = ?, error_message = ?, completed_at = ?, updated_at = ?
       WHERE id = ? AND organization_id = ? AND write_operation_id = ? AND status IN (${from.map(() => "?").join(", ")}) AND ${input.guard.sql}`
  ).bind(to, input.sageRecordId, input.sageRecordNumber, input.errorMessage, input.now, input.now,
    input.requestId, input.organizationId, input.operationId, ...from, ...input.guard.binds)
}
