import { eq, and } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import { netsuiteSyncMetadata } from "@/db/schema-netsuite"
import { RecordClient } from "../client/record-client"
import type { BaseMapper } from "../mappers/base-mapper"
import { generateIdempotencyKey } from "./idempotency"
import { NetSuiteError } from "../client/errors"

export interface PushResult {
  pushed: number
  failed: number
  errors: Array<{ localId: string; error: string }>
}

export async function pushPendingChanges(
  db: DrizzleD1Database,
  recordClient: RecordClient,
  mapper: BaseMapper<
    Record<string, unknown>,
    Record<string, unknown>
  >,
  getLocalRecord: (id: string) => Promise<Record<string, unknown> | null>
): Promise<PushResult> {
  const result: PushResult = { pushed: 0, failed: 0, errors: [] }
  const tableName = mapper.getLocalTable()

  const pending = await db
    .select()
    .from(netsuiteSyncMetadata)
    .where(
      and(
        eq(netsuiteSyncMetadata.localTable, tableName),
        eq(netsuiteSyncMetadata.syncStatus, "pending_push")
      )
    )

  for (const meta of pending) {
    try {
      const local = await getLocalRecord(meta.localRecordId)
      if (!local) {
        await markError(db, meta.id, "Local record not found")
        result.failed++
        continue
      }

      const remoteData = mapper.toRemote(local)
      const recordType = mapper.getNetSuiteRecordType()

      if (meta.netsuiteInternalId) {
        await recordClient.update(
          recordType,
          meta.netsuiteInternalId,
          remoteData
        )
      } else {
        const key = generateIdempotencyKey(
          "create",
          recordType,
          meta.localRecordId
        )
        const created = await recordClient.create(
          recordType,
          remoteData,
          key
        )

        await db
          .update(netsuiteSyncMetadata)
          .set({ netsuiteInternalId: created.id })
          .where(eq(netsuiteSyncMetadata.id, meta.id))
      }

      await db
        .update(netsuiteSyncMetadata)
        .set({
          syncStatus: "synced",
          lastSyncedAt: new Date().toISOString(),
          errorMessage: null,
          retryCount: 0,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(netsuiteSyncMetadata.id, meta.id))

      result.pushed++
    } catch (err) {
      const message = err instanceof NetSuiteError
        ? err.message
        : "Unknown error"

      const retryable = err instanceof NetSuiteError && err.retryable
      if (retryable && meta.retryCount < 3) {
        await db
          .update(netsuiteSyncMetadata)
          .set({
            retryCount: meta.retryCount + 1,
            errorMessage: message,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(netsuiteSyncMetadata.id, meta.id))
      } else {
        await markError(db, meta.id, message)
      }

      result.failed++
      result.errors.push({
        localId: meta.localRecordId,
        error: message,
      })
    }
  }

  return result
}

async function markError(
  db: DrizzleD1Database,
  metaId: string,
  message: string
): Promise<void> {
  await db
    .update(netsuiteSyncMetadata)
    .set({
      syncStatus: "error",
      errorMessage: message,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(netsuiteSyncMetadata.id, metaId))
}
