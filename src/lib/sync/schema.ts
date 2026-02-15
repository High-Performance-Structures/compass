import {
  sqliteTable,
  text,
  integer,
  index,
} from "drizzle-orm/sqlite-core"

// Sync metadata for tracking local changes and sync state
// Each record tracks its vector clock and sync status
export const localSyncMetadata = sqliteTable(
  "local_sync_metadata",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tableName: text("table_name").notNull(),
    recordId: text("record_id").notNull(),
    // Vector clock as JSON: { "clientA": 5, "clientB": 3 }
    // Used to detect concurrent modifications
    vectorClock: text("vector_clock").notNull(),
    lastModifiedAt: text("last_modified_at").notNull(),
    syncStatus: text("sync_status", {
      enum: ["pending_sync", "synced", "conflict"],
    })
      .notNull()
      .default("pending_sync"),
    // JSON of the conflicting remote data when status is "conflict"
    conflictData: text("conflict_data"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    // Speed up lookups by table + record (used in getMetadata)
    tableRecordIdx: index("local_sync_metadata_table_record_idx").on(
      table.tableName,
      table.recordId
    ),
  })
)

// Queue for mutations created while offline
// Processed in order when connection is restored
export const mutationQueue = sqliteTable(
  "mutation_queue",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    operation: text("operation", {
      enum: ["insert", "update", "delete"],
    }).notNull(),
    tableName: text("table_name").notNull(),
    recordId: text("record_id").notNull(),
    // JSON payload of the mutation data
    payload: text("payload"),
    // Vector clock at time of mutation
    vectorClock: text("vector_clock").notNull(),
    status: text("status", {
      enum: ["pending", "processing", "completed", "failed"],
    })
      .notNull()
      .default("pending"),
    retryCount: integer("retry_count").notNull().default(0),
    errorMessage: text("error_message"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    // When to process this entry (for non-blocking backoff)
    processAfter: text("process_after"),
  },
  (table) => ({
    // Speed up pending queue queries with FIFO ordering
    statusCreatedIdx: index("mutation_queue_status_created_idx").on(
      table.status,
      table.createdAt
    ),
  })
)

// Sync checkpoint for tracking last successful pull
export const syncCheckpoint = sqliteTable(
  "sync_checkpoint",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tableName: text("table_name").notNull().unique(),
    // Server timestamp or cursor for delta queries
    lastSyncCursor: text("last_sync_cursor"),
    // Local vector clock at last sync
    localVectorClock: text("local_vector_clock"),
    syncedAt: text("synced_at").notNull(),
  },
  (table) => ({
    // Speed up checkpoint lookups by table name
    tableNameIdx: index("sync_checkpoint_table_name_idx").on(table.tableName),
  })
)

// Tombstones track deleted records for sync
// Used to propagate deletes to remote and detect deleted records on pull
export const syncTombstone = sqliteTable(
  "sync_tombstone",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tableName: text("table_name").notNull(),
    recordId: text("record_id").notNull(),
    // Vector clock at time of deletion
    vectorClock: text("vector_clock").notNull(),
    deletedAt: text("deleted_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    // Whether the delete has been synced to remote
    synced: integer("synced", { mode: "boolean" }).notNull().default(false),
  },
  (table) => ({
    // Speed up tombstone lookups
    tableRecordIdx: index("sync_tombstone_table_record_idx").on(
      table.tableName,
      table.recordId
    ),
    // Speed up unsynced tombstone queries
    syncedIdx: index("sync_tombstone_synced_idx").on(table.synced),
  })
)

// Type exports
export type LocalSyncMetadata = typeof localSyncMetadata.$inferSelect
export type NewLocalSyncMetadata = typeof localSyncMetadata.$inferInsert
export type MutationQueueEntry = typeof mutationQueue.$inferSelect
export type NewMutationQueueEntry = typeof mutationQueue.$inferInsert
export type SyncCheckpoint = typeof syncCheckpoint.$inferSelect
export type NewSyncCheckpoint = typeof syncCheckpoint.$inferInsert
export type SyncTombstone = typeof syncTombstone.$inferSelect
export type NewSyncTombstone = typeof syncTombstone.$inferInsert

// Status enums for type-safe usage
export const SyncStatus = {
  PENDING_SYNC: "pending_sync",
  SYNCED: "synced",
  CONFLICT: "conflict",
} as const

export const MutationStatus = {
  PENDING: "pending",
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
} as const

export const OperationType = {
  INSERT: "insert",
  UPDATE: "update",
  DELETE: "delete",
} as const

export type SyncStatusType = (typeof SyncStatus)[keyof typeof SyncStatus]
export type MutationStatusType =
  (typeof MutationStatus)[keyof typeof MutationStatus]
export type OperationTypeType =
  (typeof OperationType)[keyof typeof OperationType]
