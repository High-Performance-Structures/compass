// Main sync engine for delta sync with conflict resolution
// Coordinates pull/push operations using the DatabaseProvider interface

import { eq, and, inArray, lt } from "drizzle-orm"
import type { DatabaseProvider, DrizzleDB } from "@/db/provider/interface"
import {
  localSyncMetadata,
  syncCheckpoint,
  syncTombstone,
  type LocalSyncMetadata,
  type SyncCheckpoint,
  SyncStatus,
  type NewLocalSyncMetadata,
} from "./schema"
import {
  type VectorClockValue,
  serializeClock,
  parseClock,
  incrementClock,
  mergeClocks,
} from "./clock"
import {
  detectConflict,
  resolveConflict,
  type ConflictStrategyType,
  type ConflictData,
  serializeConflictData,
  ConflictStrategy,
} from "./conflict"
import { MutationQueueManager } from "./queue/mutation-queue"
import { SyncProcessor, type MutationHandler } from "./queue/processor"

// Sync result types
export interface SyncResult {
  pulled: number
  pushed: number
  conflicts: number
  errors: Array<{ recordId: string; error: string }>
  duration: number
}

export interface PullResult {
  created: number
  updated: number
  conflicts: number
  errors: Array<{ recordId: string; error: string }>
}

export interface PushResult {
  pushed: number
  failed: number
  errors: Array<{ recordId: string; error: string }>
}

// Remote record interface for pull operations
export interface RemoteRecord {
  id: string
  updatedAt: string
  [key: string]: unknown
}

// Configuration
export interface SyncEngineConfig {
  // Client ID for vector clock
  clientId: string
  // Conflict resolution strategy
  conflictStrategy: ConflictStrategyType
  // Table names to sync
  tables: string[]
}

const DEFAULT_CONFIG: Partial<SyncEngineConfig> = {
  conflictStrategy: ConflictStrategy.NEWEST_WINS,
  tables: [],
}

// Callback types for custom upsert/fetch logic
export type UpsertLocalFn<T = Record<string, unknown>> = (
  localId: string | null,
  data: T
) => Promise<string>

export type GetLocalRecordFn<T = Record<string, unknown>> = (
  id: string
) => Promise<T | null>

export type FetchRemoteChangesFn<T = RemoteRecord> = (
  tableName: string,
  sinceCursor: string | null
) => Promise<{ records: T[]; nextCursor: string | null }>

export type PushMutationFn = (
  tableName: string,
  operation: "insert" | "update" | "delete",
  recordId: string,
  payload: Record<string, unknown> | null,
  vectorClock: VectorClockValue
) => Promise<boolean>

export class SyncEngine {
  private provider: DatabaseProvider
  private config: SyncEngineConfig
  private queueManager: MutationQueueManager | null = null
  private processor: SyncProcessor | null = null

  constructor(provider: DatabaseProvider, config: SyncEngineConfig) {
    this.provider = provider
    this.config = { ...DEFAULT_CONFIG, ...config } as SyncEngineConfig
  }

  // Initialize the sync engine (must be called before use)
  async initialize(): Promise<void> {
    const db = await this.provider.getDb()
    this.queueManager = new MutationQueueManager(db)
    this.processor = new SyncProcessor(db)
  }

  // Get the underlying database
  private async getDb(): Promise<DrizzleDB> {
    return this.provider.getDb()
  }

  // Full sync cycle: pull then push
  async sync<T = Record<string, unknown>>(
    tableName: string,
    fetchRemote: FetchRemoteChangesFn,
    upsertLocal: UpsertLocalFn<T>,
    getLocalRecord: GetLocalRecordFn<T>,
    pushMutation: PushMutationFn
  ): Promise<SyncResult> {
    const start = Date.now()
    const result: SyncResult = {
      pulled: 0,
      pushed: 0,
      conflicts: 0,
      errors: [],
      duration: 0,
    }

    // Pull changes from remote
    const pullResult = await this.pull(tableName, fetchRemote, upsertLocal)
    result.pulled = pullResult.created + pullResult.updated
    result.conflicts = pullResult.conflicts
    result.errors.push(...pullResult.errors)

    // Push local changes
    const pushResult = await this.push(tableName, getLocalRecord, pushMutation)
    result.pushed = pushResult.pushed
    result.errors.push(...pushResult.errors)

    result.duration = Date.now() - start
    return result
  }

  // Pull changes from remote server
  // Uses batch processing: fetches metadata for all records upfront,
  // then batch upserts in a single transaction
  async pull<T = Record<string, unknown>>(
    tableName: string,
    fetchRemote: FetchRemoteChangesFn,
    upsertLocal: UpsertLocalFn<T>
  ): Promise<PullResult> {
    const result: PullResult = {
      created: 0,
      updated: 0,
      conflicts: 0,
      errors: [],
    }

    const db = await this.getDb()

    // Get last sync checkpoint
    const checkpoint = await this.getCheckpoint(tableName)
    const sinceCursor = checkpoint?.lastSyncCursor ?? null

    // Fetch remote changes
    const { records, nextCursor } = await fetchRemote(tableName, sinceCursor)

    // Update checkpoint even if no records (cursor still advances)
    if (nextCursor) {
      const db = await this.getDb()
      await this.updateCheckpoint(db, tableName, nextCursor)
    }

    if (records.length === 0) {
      return result
    }

    // Batch fetch all existing metadata for these records
    const recordIds = records.map((r) => r.id)
    const existingMetadata = await this.getMetadataBatch(tableName, recordIds)
    const metadataMap = new Map(existingMetadata.map((m) => [m.recordId, m]))

    // Process tombstones - check if any remote records were locally deleted
    const tombstones = await this.getTombstonesBatch(tableName, recordIds)
    const tombstoneSet = new Set(tombstones.map((t) => t.recordId))

    // Prepare batch operations
    const toCreate: Array<{ remote: RemoteRecord; metadata: NewLocalSyncMetadata }> = []
    const toUpdate: Array<{ remote: RemoteRecord; metadata: LocalSyncMetadata }> = []
    const conflicts: Array<{ remote: RemoteRecord; metadata: LocalSyncMetadata }> = []

    for (const remote of records) {
      // Skip records that were locally deleted (tombstone wins)
      if (tombstoneSet.has(remote.id)) {
        continue
      }

      const metadata = metadataMap.get(remote.id)

      if (!metadata) {
        // New record - will be created
        const remoteClockRaw = remote.vectorClock as string | undefined
        const remoteClock = remoteClockRaw ? parseClock(remoteClockRaw) : {}
        toCreate.push({
          remote,
          metadata: {
            tableName,
            recordId: remote.id,
            vectorClock: serializeClock(remoteClock),
            lastModifiedAt: remote.updatedAt,
            syncStatus: SyncStatus.SYNCED,
            createdAt: new Date().toISOString(),
          },
        })
      } else {
        // Check for conflict
        const remoteClockRaw = remote.vectorClock as string | undefined
        const remoteClock = remoteClockRaw ? parseClock(remoteClockRaw) : {}

        const conflictResult = detectConflict(
          metadata.vectorClock,
          serializeClock(remoteClock)
        )

        if (conflictResult.hasConflict && metadata.syncStatus === SyncStatus.PENDING_SYNC) {
          conflicts.push({ remote, metadata })
        } else {
          toUpdate.push({ remote, metadata })
        }
      }
    }

    // Batch upsert new records
    if (toCreate.length > 0) {
      for (const { remote, metadata } of toCreate) {
        try {
          const localData = remote as unknown as T
          await upsertLocal(null, localData)
          result.created++
        } catch (err) {
          result.errors.push({
            recordId: remote.id,
            error: err instanceof Error ? err.message : "Unknown error",
          })
        }
      }

      // Batch insert metadata
      await db.insert(localSyncMetadata).values(
        toCreate.map(({ metadata }) => metadata)
      )
    }

    // Batch update existing records
    if (toUpdate.length > 0) {
      for (const { remote, metadata } of toUpdate) {
        try {
          const remoteClockRaw = remote.vectorClock as string | undefined
          const remoteClock = remoteClockRaw ? parseClock(remoteClockRaw) : {}

          const localData = remote as unknown as T
          await upsertLocal(metadata.recordId, localData)
          result.updated++
        } catch (err) {
          result.errors.push({
            recordId: remote.id,
            error: err instanceof Error ? err.message : "Unknown error",
          })
        }
      }

      // Batch update metadata with merged clocks
      for (const { remote, metadata } of toUpdate) {
        const remoteClockRaw = remote.vectorClock as string | undefined
        const remoteClock = remoteClockRaw ? parseClock(remoteClockRaw) : {}
        const mergedClock = mergeClocks(parseClock(metadata.vectorClock), remoteClock)

        await db
          .update(localSyncMetadata)
          .set({
            vectorClock: serializeClock(mergedClock),
            lastModifiedAt: remote.updatedAt,
            syncStatus: SyncStatus.SYNCED,
          })
          .where(eq(localSyncMetadata.id, metadata.id))
      }
    }

    // Process conflicts
    for (const { remote, metadata } of conflicts) {
      const remoteClockRaw = remote.vectorClock as string | undefined
      const remoteClock = remoteClockRaw ? parseClock(remoteClockRaw) : {}

      const resolution = resolveConflict(
        this.config.conflictStrategy,
        {},
        remote as unknown as Record<string, unknown>,
        parseClock(metadata.vectorClock),
        remoteClock,
        metadata.lastModifiedAt,
        remote.updatedAt
      )

      if (resolution.resolution === "flag_manual") {
        const conflictData: ConflictData = {
          local: {},
          remote: remote as unknown as Record<string, unknown>,
          localClock: parseClock(metadata.vectorClock),
          remoteClock,
          localModifiedAt: metadata.lastModifiedAt,
          remoteModifiedAt: remote.updatedAt,
          detectedAt: new Date().toISOString(),
          reason: resolution.reason,
        }

        await db
          .update(localSyncMetadata)
          .set({
            syncStatus: SyncStatus.CONFLICT,
            conflictData: serializeConflictData(conflictData),
          })
          .where(eq(localSyncMetadata.id, metadata.id))

        result.conflicts++
      } else {
        // Auto-resolved - treat as update
        const localData = remote as unknown as T
        await upsertLocal(metadata.recordId, localData)

        const mergedClock = mergeClocks(parseClock(metadata.vectorClock), remoteClock)
        await db
          .update(localSyncMetadata)
          .set({
            vectorClock: serializeClock(mergedClock),
            lastModifiedAt: remote.updatedAt,
            syncStatus: SyncStatus.SYNCED,
          })
          .where(eq(localSyncMetadata.id, metadata.id))

        result.updated++
      }
    }

    return result
  }

  // Push local mutations to remote server
  async push<T = Record<string, unknown>>(
    tableName: string,
    getLocalRecord: GetLocalRecordFn<T>,
    pushMutation: PushMutationFn
  ): Promise<PushResult> {
    const result: PushResult = {
      pushed: 0,
      failed: 0,
      errors: [],
    }

    if (!this.queueManager) {
      await this.initialize()
    }

    const pending = await this.queueManager!.getPending()

    for (const entry of pending) {
      if (entry.tableName !== tableName) continue

      try {
        const payload = entry.payload
          ? (JSON.parse(entry.payload) as Record<string, unknown>)
          : null

        const vectorClock = parseClock(entry.vectorClock)

        const success = await pushMutation(
          entry.tableName,
          entry.operation as "insert" | "update" | "delete",
          entry.recordId,
          payload,
          vectorClock
        )

        if (success) {
          await this.queueManager!.markCompleted(entry.id)
          result.pushed++
        } else {
          await this.queueManager!.markFailed(entry.id, "Push failed")
          result.failed++
          result.errors.push({
            recordId: entry.recordId,
            error: "Push returned false",
          })
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error"
        await this.queueManager!.markFailed(entry.id, errorMessage)
        result.failed++
        result.errors.push({
          recordId: entry.recordId,
          error: errorMessage,
        })
      }
    }

    return result
  }

  // Record a local mutation (adds to queue and updates metadata)
  async recordMutation(
    tableName: string,
    operation: "insert" | "update" | "delete",
    recordId: string,
    payload: Record<string, unknown> | null
  ): Promise<void> {
    const db = await this.getDb()

    if (!this.queueManager) {
      this.queueManager = new MutationQueueManager(db)
    }

    // Get or create sync metadata
    const metadata = await this.getMetadata(tableName, recordId)
    let vectorClock: VectorClockValue

    if (metadata) {
      vectorClock = incrementClock(
        parseClock(metadata.vectorClock),
        this.config.clientId
      )
      await db
        .update(localSyncMetadata)
        .set({
          vectorClock: serializeClock(vectorClock),
          lastModifiedAt: new Date().toISOString(),
          syncStatus: SyncStatus.PENDING_SYNC,
        })
        .where(eq(localSyncMetadata.id, metadata.id))
    } else {
      vectorClock = { [this.config.clientId]: 1 }
      const now = new Date().toISOString()
      await db.insert(localSyncMetadata).values({
        tableName,
        recordId,
        vectorClock: serializeClock(vectorClock),
        lastModifiedAt: now,
        syncStatus: SyncStatus.PENDING_SYNC,
        createdAt: now,
      })
    }

    // Add to mutation queue
    await this.queueManager.enqueue(
      operation,
      tableName,
      recordId,
      payload,
      vectorClock
    )
  }

  // Start background sync processor
  startBackgroundSync(handler: MutationHandler): void {
    if (!this.processor) {
      throw new Error("SyncEngine not initialized. Call initialize() first.")
    }

    this.processor.setHandler(handler)
    this.processor.start()
  }

  // Stop background sync processor
  stopBackgroundSync(): void {
    this.processor?.stop()
  }

  // Get sync status for a record
  async getRecordStatus(
    tableName: string,
    recordId: string
  ): Promise<LocalSyncMetadata | null> {
    return this.getMetadata(tableName, recordId)
  }

  // Get all records in conflict state
  async getConflicts(tableName?: string): Promise<LocalSyncMetadata[]> {
    const db = await this.getDb()

    const conditions = [eq(localSyncMetadata.syncStatus, SyncStatus.CONFLICT)]

    if (tableName) {
      conditions.push(eq(localSyncMetadata.tableName, tableName))
    }

    return db
      .select()
      .from(localSyncMetadata)
      .where(and(...conditions))
  }

  // Resolve a conflict manually
  async resolveConflict(
    tableName: string,
    recordId: string,
    resolution: "use_local" | "use_remote"
  ): Promise<void> {
    const db = await this.getDb()
    const metadata = await this.getMetadata(tableName, recordId)

    if (!metadata || !metadata.conflictData) {
      throw new Error("No conflict found for this record")
    }

    if (resolution === "use_local") {
      // Mark as pending push to send local version
      await db
        .update(localSyncMetadata)
        .set({
          syncStatus: SyncStatus.PENDING_SYNC,
          conflictData: null,
          lastModifiedAt: new Date().toISOString(),
        })
        .where(eq(localSyncMetadata.id, metadata.id))
    } else {
      // Use remote version - mark as synced
      const conflictData = JSON.parse(metadata.conflictData) as ConflictData
      await db
        .update(localSyncMetadata)
        .set({
          syncStatus: SyncStatus.SYNCED,
          conflictData: null,
          vectorClock: serializeClock(conflictData.remoteClock),
          lastModifiedAt: new Date().toISOString(),
        })
        .where(eq(localSyncMetadata.id, metadata.id))
    }
  }

  // Private helpers

  private async processRemoteRecord<T>(
    db: DrizzleDB,
    tableName: string,
    remote: RemoteRecord,
    upsertLocal: UpsertLocalFn<T>
  ): Promise<string | "conflict"> {
    const metadata = await this.getMetadata(tableName, remote.id)

    // Assume remote has a vector clock in its data
    const remoteClockRaw = remote.vectorClock as string | undefined
    const remoteClock = remoteClockRaw ? parseClock(remoteClockRaw) : {}

    if (!metadata) {
      // New record - insert locally
      const localData = remote as unknown as T
      const localId = await upsertLocal(null, localData)

      const now = new Date().toISOString()
      await db.insert(localSyncMetadata).values({
        tableName,
        recordId: remote.id,
        vectorClock: serializeClock(remoteClock),
        lastModifiedAt: remote.updatedAt,
        syncStatus: SyncStatus.SYNCED,
        createdAt: now,
      })

      return "created"
    }

    // Check for conflict
    const conflictResult = detectConflict(
      metadata.vectorClock,
      serializeClock(remoteClock)
    )

    if (conflictResult.hasConflict && metadata.syncStatus === SyncStatus.PENDING_SYNC) {
      // Conflict detected
      const resolution = resolveConflict(
        this.config.conflictStrategy,
        {}, // local data would need to be fetched
        remote as unknown as Record<string, unknown>,
        parseClock(metadata.vectorClock),
        remoteClock,
        metadata.lastModifiedAt,
        remote.updatedAt
      )

      if (resolution.resolution === "flag_manual") {
        const conflictData: ConflictData = {
          local: {}, // Would need to fetch actual local data
          remote: remote as unknown as Record<string, unknown>,
          localClock: parseClock(metadata.vectorClock),
          remoteClock,
          localModifiedAt: metadata.lastModifiedAt,
          remoteModifiedAt: remote.updatedAt,
          detectedAt: new Date().toISOString(),
          reason: resolution.reason,
        }

        await db
          .update(localSyncMetadata)
          .set({
            syncStatus: SyncStatus.CONFLICT,
            conflictData: serializeConflictData(conflictData),
          })
          .where(eq(localSyncMetadata.id, metadata.id))

        return "conflict"
      }
    }

    // No conflict or auto-resolved - update locally
    const localData = remote as unknown as T
    await upsertLocal(metadata.recordId, localData)

    // Merge clocks and mark synced
    const mergedClock = mergeClocks(parseClock(metadata.vectorClock), remoteClock)
    await db
      .update(localSyncMetadata)
      .set({
        vectorClock: serializeClock(mergedClock),
        lastModifiedAt: remote.updatedAt,
        syncStatus: SyncStatus.SYNCED,
      })
      .where(eq(localSyncMetadata.id, metadata.id))

    return "updated"
  }

  private async getMetadata(
    tableName: string,
    recordId: string
  ): Promise<LocalSyncMetadata | null> {
    const db = await this.getDb()
    const results = await db
      .select()
      .from(localSyncMetadata)
      .where(
        and(
          eq(localSyncMetadata.tableName, tableName),
          eq(localSyncMetadata.recordId, recordId)
        )
      )
      .limit(1)

    return results[0] ?? null
  }

  // Batch fetch metadata for multiple records (efficient for pull operations)
  private async getMetadataBatch(
    tableName: string,
    recordIds: string[]
  ): Promise<LocalSyncMetadata[]> {
    if (recordIds.length === 0) return []

    const db = await this.getDb()

    // Split into chunks to avoid query size limits
    const chunkSize = 100
    const results: LocalSyncMetadata[] = []

    for (let i = 0; i < recordIds.length; i += chunkSize) {
      const chunk = recordIds.slice(i, i + chunkSize)
      const chunkResults = await db
        .select()
        .from(localSyncMetadata)
        .where(
          and(
            eq(localSyncMetadata.tableName, tableName),
            inArray(localSyncMetadata.recordId, chunk)
          )
        )
      results.push(...chunkResults)
    }

    return results
  }

  // Batch fetch tombstones for multiple records
  private async getTombstonesBatch(
    tableName: string,
    recordIds: string[]
  ): Promise<Array<{ recordId: string }>> {
    if (recordIds.length === 0) return []

    const db = await this.getDb()

    const chunkSize = 100
    const results: Array<{ recordId: string }> = []

    for (let i = 0; i < recordIds.length; i += chunkSize) {
      const chunk = recordIds.slice(i, i + chunkSize)
      const chunkResults = await db
        .select()
        .from(syncTombstone)
        .where(
          and(
            eq(syncTombstone.tableName, tableName),
            inArray(syncTombstone.recordId, chunk)
          )
        )
      // Map to only return recordId
      results.push(...chunkResults.map((r) => ({ recordId: r.recordId })))
    }

    return results
  }

  // Create a tombstone for a deleted record
  async createTombstone(
    tableName: string,
    recordId: string,
    vectorClock: VectorClockValue
  ): Promise<void> {
    const db = await this.getDb()

    await db.insert(syncTombstone).values({
      tableName,
      recordId,
      vectorClock: serializeClock(vectorClock),
      deletedAt: new Date().toISOString(),
      synced: false,
    })

    // Remove the sync metadata since record is deleted
    await db
      .delete(localSyncMetadata)
      .where(
        and(
          eq(localSyncMetadata.tableName, tableName),
          eq(localSyncMetadata.recordId, recordId)
        )
      )
  }

  // Mark tombstone as synced after successful push
  async markTombstoneSynced(tableName: string, recordId: string): Promise<void> {
    const db = await this.getDb()

    await db
      .update(syncTombstone)
      .set({ synced: true })
      .where(
        and(
          eq(syncTombstone.tableName, tableName),
          eq(syncTombstone.recordId, recordId)
        )
      )
  }

  // Get unsynced tombstones for push operations
  async getUnsyncedTombstones(tableName?: string): Promise<
    Array<{
      tableName: string
      recordId: string
      vectorClock: string
      deletedAt: string
    }>
  > {
    const db = await this.getDb()

    const conditions = [eq(syncTombstone.synced, false)]

    if (tableName) {
      conditions.push(eq(syncTombstone.tableName, tableName))
    }

    const results = await db
      .select()
      .from(syncTombstone)
      .where(and(...conditions))

    return results.map((r) => ({
      tableName: r.tableName,
      recordId: r.recordId,
      vectorClock: r.vectorClock,
      deletedAt: r.deletedAt,
    }))
  }

  // Cleanup synced tombstones older than a given age
  async cleanupTombstones(maxAgeMs: number): Promise<number> {
    const db = await this.getDb()
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString()

    const toDelete = await db
      .select()
      .from(syncTombstone)
      .where(
        and(
          eq(syncTombstone.synced, true),
          // Tombstones synced before cutoff
          lt(syncTombstone.deletedAt, cutoff)
        )
      )

    await db
      .delete(syncTombstone)
      .where(
        and(
          eq(syncTombstone.synced, true),
          lt(syncTombstone.deletedAt, cutoff)
        )
      )

    return toDelete.length
  }

  private async getCheckpoint(tableName: string): Promise<SyncCheckpoint | null> {
    const db = await this.getDb()
    const results = await db
      .select()
      .from(syncCheckpoint)
      .where(eq(syncCheckpoint.tableName, tableName))
      .limit(1)

    return results[0] ?? null
  }

  private async updateCheckpoint(
    db: DrizzleDB,
    tableName: string,
    cursor: string
  ): Promise<void> {
    const existing = await this.getCheckpoint(tableName)
    const now = new Date().toISOString()

    if (existing) {
      await db
        .update(syncCheckpoint)
        .set({
          lastSyncCursor: cursor,
          syncedAt: now,
        })
        .where(eq(syncCheckpoint.tableName, tableName))
    } else {
      await db.insert(syncCheckpoint).values({
        tableName,
        lastSyncCursor: cursor,
        syncedAt: now,
      })
    }
  }
}

// Factory function
export function createSyncEngine(
  provider: DatabaseProvider,
  config: SyncEngineConfig
): SyncEngine {
  return new SyncEngine(provider, config)
}
