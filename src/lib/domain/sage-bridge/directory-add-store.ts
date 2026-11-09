import { and, eq, inArray, type SQL } from "drizzle-orm"
import type { SQLiteInsertValue } from "drizzle-orm/sqlite-core"

import { sageDirectoryAddRequests } from "@/db/schema-sage"
import type { Db } from "@/lib/server/action-context"

/*
 * The only writer of sage_directory_add_requests ("Request add to Sage").
 * Reads and the workflow live in src/lib/sage/directory-add-service.ts.
 */

type AddRequestPatch = Partial<Omit<typeof sageDirectoryAddRequests.$inferInsert, "id" | "organizationId" | "requestedAt">>

export function insertSageDirectoryAddRequest(db: Db, values: SQLiteInsertValue<typeof sageDirectoryAddRequests>) {
  return db.insert(sageDirectoryAddRequests).values(values)
}

/** Updates the request only while it is still in one of `fromStatuses`; returns how many rows changed. */
export async function updateSageDirectoryAddRequest(
  db: Db,
  input: {
    readonly id: string
    readonly organizationId: string
    readonly fromStatuses: readonly (typeof sageDirectoryAddRequests.$inferSelect)["status"][]
    readonly values: AddRequestPatch
  }
): Promise<number> {
  const where: SQL | undefined = and(
    eq(sageDirectoryAddRequests.id, input.id),
    eq(sageDirectoryAddRequests.organizationId, input.organizationId),
    inArray(sageDirectoryAddRequests.status, [...input.fromStatuses])
  )
  const result = await db.update(sageDirectoryAddRequests).set(input.values).where(where).run()
  return result.meta.changes
}
