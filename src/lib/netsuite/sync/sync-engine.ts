import { eq, desc } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import { netsuiteSyncLog, netsuiteSyncMetadata } from "@/db/schema-netsuite"
import { getNetSuiteConfig } from "../config"
import { TokenManager } from "../auth/token-manager"
import { BaseClient } from "../client/base-client"
import { RecordClient } from "../client/record-client"
import { SuiteQLClient } from "../client/suiteql-client"
import { ConcurrencyLimiter } from "../rate-limiter/concurrency-limiter"
import { pullDelta, type DeltaSyncResult } from "./delta-sync"
import { pushPendingChanges, type PushResult } from "./push"
import type { BaseMapper } from "../mappers/base-mapper"
import type { ConflictStrategy, SyncDirection } from "../client/types"

export interface SyncRunResult {
  direction: SyncDirection
  recordType: string
  pull?: DeltaSyncResult
  push?: PushResult
  duration: number
}

export class SyncEngine {
  private db: DrizzleD1Database
  private recordClient: RecordClient
  private suiteqlClient: SuiteQLClient
  private conflictStrategy: ConflictStrategy

  constructor(
    db: DrizzleD1Database,
    env: Record<string, string | undefined>,
    conflictStrategy: ConflictStrategy = "newest_wins"
  ) {
    this.db = db
    this.conflictStrategy = conflictStrategy

    const config = getNetSuiteConfig(
      env as Record<string, string>
    )
    const tokenManager = new TokenManager(config, db as never)
    const limiter = new ConcurrencyLimiter(config.concurrencyLimit)
    const baseClient = new BaseClient(tokenManager, limiter)

    this.recordClient = new RecordClient(
      baseClient,
      config.accountId
    )
    this.suiteqlClient = new SuiteQLClient(
      baseClient,
      config.accountId
    )
  }

  async pull(
    mapper: BaseMapper<
      Record<string, unknown>,
      Record<string, unknown>
    >,
    upsertLocal: (
      localId: string | null,
      data: Record<string, unknown>
    ) => Promise<string>
  ): Promise<SyncRunResult> {
    const start = Date.now()
    const recordType = mapper.getNetSuiteRecordType()
    const logId = await this.startLog("delta", recordType, "pull")

    try {
      const lastSync = await this.getLastSyncTime(
        mapper.getLocalTable(),
        "pull"
      )
      const result = await pullDelta(
        this.db,
        this.suiteqlClient,
        mapper,
        lastSync,
        this.conflictStrategy,
        upsertLocal
      )

      await this.completeLog(logId, "completed", result.pulled, result.errors.length)

      return {
        direction: "pull",
        recordType,
        pull: result,
        duration: Date.now() - start,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown"
      await this.completeLog(logId, "failed", 0, 0, message)
      throw err
    }
  }

  async push(
    mapper: BaseMapper<
      Record<string, unknown>,
      Record<string, unknown>
    >,
    getLocalRecord: (
      id: string
    ) => Promise<Record<string, unknown> | null>
  ): Promise<SyncRunResult> {
    const start = Date.now()
    const recordType = mapper.getNetSuiteRecordType()
    const logId = await this.startLog("delta", recordType, "push")

    try {
      const result = await pushPendingChanges(
        this.db,
        this.recordClient,
        mapper,
        getLocalRecord
      )

      await this.completeLog(
        logId,
        "completed",
        result.pushed,
        result.failed
      )

      return {
        direction: "push",
        recordType,
        push: result,
        duration: Date.now() - start,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown"
      await this.completeLog(logId, "failed", 0, 0, message)
      throw err
    }
  }

  async fullSync(
    mapper: BaseMapper<
      Record<string, unknown>,
      Record<string, unknown>
    >,
    upsertLocal: (
      localId: string | null,
      data: Record<string, unknown>
    ) => Promise<string>,
    getLocalRecord: (
      id: string
    ) => Promise<Record<string, unknown> | null>
  ): Promise<{ pull: SyncRunResult; push: SyncRunResult }> {
    const pullResult = await this.pull(mapper, upsertLocal)
    const pushResult = await this.push(mapper, getLocalRecord)
    return { pull: pullResult, push: pushResult }
  }

  async getSyncHistory(
    limit = 20
  ): Promise<typeof netsuiteSyncLog.$inferSelect[]> {
    return this.db
      .select()
      .from(netsuiteSyncLog)
      .orderBy(desc(netsuiteSyncLog.createdAt))
      .limit(limit)
  }

  async getConflicts() {
    return this.db
      .select()
      .from(netsuiteSyncMetadata)
      .where(eq(netsuiteSyncMetadata.syncStatus, "conflict"))
  }

  async resolveConflict(
    metaId: string,
    resolution: "use_local" | "use_remote"
  ): Promise<void> {
    const newStatus = resolution === "use_local"
      ? "pending_push"
      : "synced"

    await this.db
      .update(netsuiteSyncMetadata)
      .set({
        syncStatus: newStatus,
        conflictData: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(netsuiteSyncMetadata.id, metaId))
  }

  private async getLastSyncTime(
    tableName: string,
    direction: string
  ): Promise<string | null> {
    const rows = await this.db
      .select({ completedAt: netsuiteSyncLog.completedAt })
      .from(netsuiteSyncLog)
      .where(eq(netsuiteSyncLog.direction, direction))
      .orderBy(desc(netsuiteSyncLog.completedAt))
      .limit(1)

    return rows[0]?.completedAt ?? null
  }

  private async startLog(
    syncType: string,
    recordType: string,
    direction: string
  ): Promise<string> {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()

    await this.db.insert(netsuiteSyncLog).values({
      id,
      syncType,
      recordType,
      direction,
      status: "running",
      recordsProcessed: 0,
      recordsFailed: 0,
      startedAt: now,
      createdAt: now,
    })

    return id
  }

  private async completeLog(
    logId: string,
    status: string,
    processed: number,
    failed: number,
    errorSummary?: string
  ): Promise<void> {
    await this.db
      .update(netsuiteSyncLog)
      .set({
        status,
        recordsProcessed: processed,
        recordsFailed: failed,
        errorSummary: errorSummary ?? null,
        completedAt: new Date().toISOString(),
      })
      .where(eq(netsuiteSyncLog.id, logId))
  }
}
