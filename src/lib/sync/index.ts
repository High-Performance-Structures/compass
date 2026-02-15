// Sync engine for offline-first data synchronization
// Provides delta sync, conflict detection, and offline mutation queue

// Schema
export {
  localSyncMetadata,
  mutationQueue,
  syncCheckpoint,
  type LocalSyncMetadata,
  type NewLocalSyncMetadata,
  type MutationQueueEntry,
  type NewMutationQueueEntry,
  type SyncCheckpoint,
  type NewSyncCheckpoint,
  SyncStatus,
  MutationStatus,
  OperationType,
  type SyncStatusType,
  type MutationStatusType,
  type OperationTypeType,
} from "./schema"

// Vector clock
export {
  VectorClock,
  type VectorClockValue,
  type ComparisonResult,
  createVectorClock,
  incrementClock,
  mergeClocks,
  compareClocks,
  serializeClock,
  parseClock,
} from "./clock"

// Conflict resolution
export {
  ConflictStrategy,
  type ConflictStrategyType,
  type ConflictDetectionResult,
  type ConflictResolutionResult,
  type ConflictData,
  detectConflict,
  resolveConflict,
  createConflictData,
  serializeConflictData,
  parseConflictData,
  needsManualResolution,
  getConflictSummary,
} from "./conflict"

// Sync engine
export {
  SyncEngine,
  createSyncEngine,
  type SyncResult,
  type PullResult,
  type PushResult,
  type RemoteRecord,
  type SyncEngineConfig,
  type UpsertLocalFn,
  type GetLocalRecordFn,
  type FetchRemoteChangesFn,
  type PushMutationFn,
} from "./engine"

// Mutation queue
export {
  MutationQueueManager,
  createMutationQueueManager,
  type MutationQueueConfig,
} from "./queue/mutation-queue"

// Sync processor
export {
  SyncProcessor,
  createSyncProcessor,
  type SyncProcessorConfig,
  type MutationHandler,
  type SyncProcessorStatus,
  type ProcessResult,
} from "./queue/processor"
