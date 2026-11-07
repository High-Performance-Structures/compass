/**
 * The only writer of the Sage change order tables (architecture standard,
 * section 1): change orders queued for Sage (sage_change_order_exports) and
 * the read-only copy of Sage's prime change orders (sage_prime_change_orders
 * and sage_prime_change_order_reads). Writes are fenced by status and claim
 * token in the WHERE clause, like the rest of the Sage bridge. No auth here:
 * callers resolve access or verify the bridge signature first.
 */
import { and, eq, lt, or, sql, type SQL } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"

import { sageChangeOrderExports, sagePrimeChangeOrderReads, sagePrimeChangeOrders } from "@/db/schema-sage"
import { chunkD1Rows } from "@/lib/d1-query"
import { SAGE_CHANGE_ORDER_EXPORT_STATUSES, type SageChangeOrderExportStatus } from "@/lib/domain/sage-bridge/statuses"
import { assertListFields } from "@/lib/shared/statuses"
import type { Db } from "@/lib/server/action-context"

const LISTS = { status: SAGE_CHANGE_ORDER_EXPORT_STATUSES }

export type QueueSageChangeOrderExport = {
  readonly organizationId: string
  readonly projectId: string
  readonly changeOrderId: string
  readonly sageChangeOrderNumber: string
  readonly payloadJson: string
  readonly requestedByUserId: string
  readonly now: string
}

/**
 * Queues one change order for the Sage writer: a new row, or the change
 * order's failed row sent again. A row that is queued, running or succeeded
 * is left alone, so the returned id list says which ones were queued.
 */
export async function queueSageChangeOrderExports(db: Db, rows: readonly QueueSageChangeOrderExport[]): Promise<readonly string[]> {
  const queued: string[] = []
  // A handful of change orders per send; each upsert is fenced on its own row.
  for (const row of rows) {
    const values = {
      id: crypto.randomUUID(),
      organizationId: row.organizationId,
      projectId: row.projectId,
      changeOrderId: row.changeOrderId,
      status: "queued" as const,
      sageChangeOrderNumber: row.sageChangeOrderNumber,
      payloadJson: row.payloadJson,
      requestedByUserId: row.requestedByUserId,
      requestedAt: row.now,
      updatedAt: row.now,
    }
    assertListFields("sage_change_order_exports", values, LISTS)
    const result = await db
      .insert(sageChangeOrderExports)
      .values(values)
      .onConflictDoUpdate({
        target: sageChangeOrderExports.changeOrderId,
        set: {
          status: "queued",
          sageChangeOrderNumber: row.sageChangeOrderNumber,
          payloadJson: row.payloadJson,
          requestedByUserId: row.requestedByUserId,
          requestedAt: row.now,
          claimToken: null,
          claimedAt: null,
          errorMessage: null,
          completedAt: null,
          updatedAt: row.now,
        },
        setWhere: and(
          eq(sageChangeOrderExports.status, "failed"),
          eq(sageChangeOrderExports.organizationId, row.organizationId)
        ),
      })
      .returning({ changeOrderId: sageChangeOrderExports.changeOrderId })
    if (result.length > 0) queued.push(row.changeOrderId)
  }
  return queued
}

/** Claims one queued (or stale running) export for the writer; false when another poll got it first. */
export async function claimSageChangeOrderExport(
  db: Db,
  input: { readonly id: string; readonly organizationId: string; readonly claimToken: string; readonly now: string; readonly staleBefore: string }
): Promise<boolean> {
  const claimed = await db
    .update(sageChangeOrderExports)
    .set({
      status: "running",
      claimToken: input.claimToken,
      claimedAt: input.now,
      attemptCount: sql`${sageChangeOrderExports.attemptCount} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(sageChangeOrderExports.id, input.id),
        eq(sageChangeOrderExports.organizationId, input.organizationId),
        or(
          eq(sageChangeOrderExports.status, "queued"),
          and(eq(sageChangeOrderExports.status, "running"), lt(sageChangeOrderExports.claimedAt, input.staleBefore))
        )
      )
    )
    .returning({ id: sageChangeOrderExports.id })
  return claimed.length > 0
}

export type SageChangeOrderExportPatch = {
  readonly status: SageChangeOrderExportStatus
  readonly sageRecordId?: string | null
  readonly errorMessage?: string | null
  readonly completedAt?: string | null
  readonly updatedAt: string
}

function exportUpdate(db: Db, where: SQL | undefined, patch: SageChangeOrderExportPatch) {
  assertListFields("sage_change_order_exports", patch, LISTS)
  return db.update(sageChangeOrderExports).set(patch).where(where)
}

/** Unexecuted update fenced by the caller's `where` (id plus claim token), for a batch. */
export function updateSageChangeOrderExportsStatement(
  db: Db,
  where: SQL | undefined,
  patch: SageChangeOrderExportPatch
): ReturnType<typeof exportUpdate> {
  return exportUpdate(db, where, patch)
}

/** Sage's prime change order, as the read-only reader sends it. */
export type SagePrimeChangeOrderSnapshotRow = {
  readonly sageRecordId: string
  readonly changeOrderNumber: string
  readonly changeOrderDate: string | null
  readonly description: string
  readonly sageStatusNumber: number | null
  readonly approvedAmountCents: number
  readonly approvedDate: string | null
  readonly linesJson: string
}

/**
 * Replaces a project's copy of its Sage job's prime change orders, as
 * statements for one atomic batch: delete, inserts, then the read record.
 */
export function replaceSagePrimeChangeOrdersStatements(
  db: Db,
  input: {
    readonly projectId: string
    readonly sageJobNumber: string
    readonly rows: readonly SagePrimeChangeOrderSnapshotRow[]
    readonly capturedAt: string
  }
): readonly BatchItem<"sqlite">[] {
  const values = input.rows.map((row) => ({
    id: crypto.randomUUID(),
    projectId: input.projectId,
    sageJobNumber: input.sageJobNumber,
    capturedAt: input.capturedAt,
    ...row,
  }))
  return [
    db.delete(sagePrimeChangeOrders).where(eq(sagePrimeChangeOrders.projectId, input.projectId)),
    ...chunkD1Rows(values).map((chunk) => db.insert(sagePrimeChangeOrders).values(chunk)),
    db
      .insert(sagePrimeChangeOrderReads)
      .values({
        projectId: input.projectId,
        sageJobNumber: input.sageJobNumber,
        changeOrderCount: input.rows.length,
        capturedAt: input.capturedAt,
      })
      .onConflictDoUpdate({
        target: sagePrimeChangeOrderReads.projectId,
        set: { sageJobNumber: input.sageJobNumber, changeOrderCount: input.rows.length, capturedAt: input.capturedAt },
      }),
  ]
}
