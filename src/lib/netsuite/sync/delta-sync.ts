import { eq, and } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import { netsuiteSyncMetadata } from "@/db/schema-netsuite"
import { SuiteQLClient } from "../client/suiteql-client"
import type { BaseMapper } from "../mappers/base-mapper"
import { resolveConflict } from "./conflict-resolver"
import type { ConflictStrategy } from "../client/types"

export interface DeltaSyncResult {
  pulled: number
  created: number
  updated: number
  conflicts: number
  errors: Array<{ netsuiteId: string; error: string }>
}

export async function pullDelta(
  db: DrizzleD1Database,
  suiteql: SuiteQLClient,
  mapper: BaseMapper<
    Record<string, unknown>,
    Record<string, unknown>
  >,
  lastSyncTime: string | null,
  conflictStrategy: ConflictStrategy,
  upsertLocal: (
    localId: string | null,
    data: Record<string, unknown>
  ) => Promise<string>
): Promise<DeltaSyncResult> {
  const result: DeltaSyncResult = {
    pulled: 0,
    created: 0,
    updated: 0,
    conflicts: 0,
    errors: [],
  }

  const query = lastSyncTime
    ? mapper.buildDeltaQuery(lastSyncTime)
    : mapper.buildSelectQuery()

  const remoteRecords = await suiteql.queryAll(query)
  result.pulled = remoteRecords.length

  for (const remote of remoteRecords) {
    try {
      const netsuiteId = String(remote.id)
      const tableName = mapper.getLocalTable()

      const existingMeta = await db
        .select()
        .from(netsuiteSyncMetadata)
        .where(
          and(
            eq(netsuiteSyncMetadata.localTable, tableName),
            eq(netsuiteSyncMetadata.netsuiteInternalId, netsuiteId)
          )
        )
        .limit(1)

      const localData = mapper.toLocal(
        remote as Record<string, unknown>
      )
      const remoteModified = String(
        remote[mapper.getLastModifiedField()] ?? ""
      )

      if (existingMeta.length > 0) {
        const meta = existingMeta[0]

        // check for conflicts on pending_push records
        if (meta.syncStatus === "pending_push") {
          const conflict = resolveConflict(
            conflictStrategy,
            meta.lastModifiedLocal,
            remoteModified
          )

          if (conflict.resolution === "flag_manual") {
            await db
              .update(netsuiteSyncMetadata)
              .set({
                syncStatus: "conflict",
                conflictData: JSON.stringify({
                  remote: localData,
                  reason: conflict.reason,
                }),
                lastModifiedRemote: remoteModified,
                updatedAt: new Date().toISOString(),
              })
              .where(eq(netsuiteSyncMetadata.id, meta.id))
            result.conflicts++
            continue
          }

          if (conflict.resolution === "use_local") {
            continue
          }
        }

        await upsertLocal(meta.localRecordId, localData)
        await db
          .update(netsuiteSyncMetadata)
          .set({
            syncStatus: "synced",
            lastSyncedAt: new Date().toISOString(),
            lastModifiedRemote: remoteModified,
            errorMessage: null,
            retryCount: 0,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(netsuiteSyncMetadata.id, meta.id))
        result.updated++
      } else {
        const localId = await upsertLocal(null, localData)
        const now = new Date().toISOString()

        await db.insert(netsuiteSyncMetadata).values({
          id: crypto.randomUUID(),
          localTable: tableName,
          localRecordId: localId,
          netsuiteRecordType: mapper.getNetSuiteRecordType(),
          netsuiteInternalId: netsuiteId,
          lastSyncedAt: now,
          lastModifiedRemote: remoteModified,
          syncStatus: "synced",
          retryCount: 0,
          createdAt: now,
          updatedAt: now,
        })
        result.created++
      }
    } catch (err) {
      result.errors.push({
        netsuiteId: String(remote.id),
        error: err instanceof Error ? err.message : "Unknown error",
      })
    }
  }

  return result
}
