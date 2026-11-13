import { and, eq, inArray, type SQL } from "drizzle-orm"
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

/** Points a sent request at the writer request already queued for it (no status change). True when it did. */
export async function relinkSageDirectoryAddOperation(
  db: Db,
  input: { readonly id: string; readonly organizationId: string; readonly fromOperationId: string; readonly toOperationId: string; readonly now: string }
): Promise<boolean> {
  const result = await db.update(sageDirectoryAddRequests)
    .set({ writeOperationId: input.toOperationId, errorMessage: null, updatedAt: input.now })
    .where(and(
      eq(sageDirectoryAddRequests.id, input.id),
      eq(sageDirectoryAddRequests.organizationId, input.organizationId),
      eq(sageDirectoryAddRequests.status, directoryAddMachine.transitions.send.to),
      eq(sageDirectoryAddRequests.writeOperationId, input.fromOperationId)
    ))
    .run()
  return result.meta.changes === 1
}
