// Mutation queue manager for offline-first sync
// Manages a persistent queue of local mutations waiting to be synced

import { eq, and, desc, lt } from "drizzle-orm"
import type { DrizzleDB } from "@/db/provider/interface"
import {
  mutationQueue,
  type MutationQueueEntry,
  type NewMutationQueueEntry,
  MutationStatus,
  type OperationTypeType,
} from "../schema"
import { type VectorClockValue, serializeClock } from "../clock"

// Queue configuration
export interface MutationQueueConfig {
  // Maximum retries before marking as failed
  maxRetries: number
  // Delay between retries (milliseconds)
  retryDelayMs: number
  // Enable localStorage persistence backup
  enablePersistence: boolean
}

const DEFAULT_CONFIG: MutationQueueConfig = {
  maxRetries: 5,
  retryDelayMs: 1000,
  enablePersistence: true,
}

// LocalStorage key for queue backup
const QUEUE_BACKUP_KEY = "compass_mutation_queue_backup"

// Persist queue state to localStorage for crash recovery
function persistQueueToStorage(entries: MutationQueueEntry[]): void {
  if (typeof window === "undefined") return

  try {
    const data = JSON.stringify({
      version: 1,
      timestamp: Date.now(),
      mutations: entries.filter(
        (e) => e.status === MutationStatus.PENDING || e.status === MutationStatus.PROCESSING
      ),
    })
    localStorage.setItem(QUEUE_BACKUP_KEY, data)
  } catch (error) {
    console.error("Failed to persist mutation queue:", error)
  }
}

// Restore queue from localStorage backup
function restoreQueueFromStorage(): MutationQueueEntry[] | null {
  if (typeof window === "undefined") return null

  try {
    const data = localStorage.getItem(QUEUE_BACKUP_KEY)
    if (!data) return null

    const parsed = JSON.parse(data) as {
      version: number
      timestamp: number
      mutations: MutationQueueEntry[]
    }

    if (parsed.version !== 1) {
      console.warn("Unknown queue backup version, skipping restore")
      return null
    }

    // Only restore if backup is less than 24 hours old
    const maxAge = 24 * 60 * 60 * 1000
    if (Date.now() - parsed.timestamp > maxAge) {
      console.info("Queue backup is stale, clearing")
      localStorage.removeItem(QUEUE_BACKUP_KEY)
      return null
    }

    // Only return pending/processing entries, reset processing to pending
    const validEntries = parsed.mutations
      .filter((m) => m.status === MutationStatus.PENDING || m.status === MutationStatus.PROCESSING)
      .map((m) => ({
        ...m,
        // Reset processing entries to pending on restore
        status: m.status === MutationStatus.PROCESSING ? MutationStatus.PENDING : m.status,
      }))

    return validEntries.length > 0 ? validEntries : null
  } catch (error) {
    console.error("Failed to restore mutation queue:", error)
    return null
  }
}

// Clear the localStorage backup
function clearQueueBackup(): void {
  if (typeof window === "undefined") return
  try {
    localStorage.removeItem(QUEUE_BACKUP_KEY)
  } catch {
    // Ignore errors
  }
}

// Get pending count from localStorage backup (for beforeunload check)
export function getBackupQueueCount(): number {
  if (typeof window === "undefined") return 0

  try {
    const data = localStorage.getItem(QUEUE_BACKUP_KEY)
    if (!data) return 0

    const parsed = JSON.parse(data) as {
      version: number
      timestamp: number
      mutations: MutationQueueEntry[]
    }

    const maxAge = 24 * 60 * 60 * 1000
    if (Date.now() - parsed.timestamp > maxAge) return 0

    return parsed.mutations.filter(
      (m) => m.status === MutationStatus.PENDING || m.status === MutationStatus.PROCESSING
    ).length
  } catch {
    return 0
  }
}

export class MutationQueueManager {
  private db: DrizzleDB
  private config: MutationQueueConfig
  private restoredEntries: MutationQueueEntry[] = []

  constructor(db: DrizzleDB, config?: Partial<MutationQueueConfig>) {
    this.db = db
    this.config = { ...DEFAULT_CONFIG, ...config }

    // Attempt to restore from localStorage backup on construction
    if (this.config.enablePersistence) {
      this.restoredEntries = restoreQueueFromStorage() ?? []
    }
  }

  // Get restored entries from localStorage (call this after construction
  // to re-insert recovered mutations into the database)
  getRestoredEntries(): MutationQueueEntry[] {
    return this.restoredEntries
  }

  // Clear restored entries after they've been processed
  clearRestoredEntries(): void {
    this.restoredEntries = []
  }

  // Persist current queue state to localStorage
  async persistQueue(): Promise<void> {
    if (!this.config.enablePersistence) return

    const pending = await this.getPending(1000)
    persistQueueToStorage(pending)
  }

  // Enqueue a new mutation
  async enqueue(
    operation: OperationTypeType,
    tableName: string,
    recordId: string,
    payload: Record<string, unknown> | null,
    vectorClock: VectorClockValue
  ): Promise<string> {
    const id = crypto.randomUUID()
    const entry: NewMutationQueueEntry = {
      id,
      operation,
      tableName,
      recordId,
      payload: payload ? JSON.stringify(payload) : null,
      vectorClock: serializeClock(vectorClock),
      status: MutationStatus.PENDING,
      retryCount: 0,
      createdAt: new Date().toISOString(),
    }

    await this.db.insert(mutationQueue).values(entry)

    // Update localStorage backup
    if (this.config.enablePersistence) {
      const currentPending = await this.getPending(1000)
      persistQueueToStorage(currentPending)
    }

    return id
  }

  // Get the next pending mutation (FIFO order)
  async dequeue(): Promise<MutationQueueEntry | null> {
    const entries = await this.db
      .select()
      .from(mutationQueue)
      .where(eq(mutationQueue.status, MutationStatus.PENDING))
      .orderBy(mutationQueue.createdAt)
      .limit(1)

    if (entries.length === 0) return null

    const entry = entries[0]!

    // Mark as processing
    await this.db
      .update(mutationQueue)
      .set({ status: MutationStatus.PROCESSING })
      .where(eq(mutationQueue.id, entry.id))

    // Update localStorage backup to reflect processing state
    if (this.config.enablePersistence) {
      const currentPending = await this.getPending(1000)
      const processing = await this.db
        .select()
        .from(mutationQueue)
        .where(eq(mutationQueue.status, MutationStatus.PROCESSING))
      persistQueueToStorage([...currentPending, ...processing])
    }

    return entry
  }

  // Peek at the next mutation without removing it
  async peek(): Promise<MutationQueueEntry | null> {
    const entries = await this.db
      .select()
      .from(mutationQueue)
      .where(eq(mutationQueue.status, MutationStatus.PENDING))
      .orderBy(mutationQueue.createdAt)
      .limit(1)

    return entries[0] ?? null
  }

  // Get all pending mutations (for batch processing)
  async getPending(limit?: number): Promise<MutationQueueEntry[]> {
    const query = this.db
      .select()
      .from(mutationQueue)
      .where(eq(mutationQueue.status, MutationStatus.PENDING))
      .orderBy(mutationQueue.createdAt)
      .limit(limit ?? 100)

    return query
  }

  // Get count of pending mutations
  async getPendingCount(): Promise<number> {
    const result = await this.db
      .select()
      .from(mutationQueue)
      .where(eq(mutationQueue.status, MutationStatus.PENDING))

    return result.length
  }

  // Get count of pending + processing mutations (for beforeunload check)
  async getActiveCount(): Promise<number> {
    const pending = await this.db
      .select()
      .from(mutationQueue)
      .where(eq(mutationQueue.status, MutationStatus.PENDING))

    const processing = await this.db
      .select()
      .from(mutationQueue)
      .where(eq(mutationQueue.status, MutationStatus.PROCESSING))

    return pending.length + processing.length
  }

  // Mark a mutation as completed
  async markCompleted(id: string): Promise<void> {
    await this.db
      .update(mutationQueue)
      .set({ status: MutationStatus.COMPLETED })
      .where(eq(mutationQueue.id, id))

    // Update localStorage backup
    if (this.config.enablePersistence) {
      const currentPending = await this.getPending(1000)
      if (currentPending.length === 0) {
        clearQueueBackup()
      } else {
        persistQueueToStorage(currentPending)
      }
    }
  }

  // Mark a mutation as failed with error message
  async markFailed(id: string, error: string): Promise<void> {
    const entry = await this.getById(id)
    if (!entry) return

    const newRetryCount = entry.retryCount + 1
    const shouldRetry = newRetryCount < this.config.maxRetries

    await this.db
      .update(mutationQueue)
      .set({
        status: shouldRetry ? MutationStatus.PENDING : MutationStatus.FAILED,
        retryCount: newRetryCount,
        errorMessage: error,
      })
      .where(eq(mutationQueue.id, id))

    // Update localStorage backup
    if (this.config.enablePersistence) {
      const currentPending = await this.getPending(1000)
      persistQueueToStorage(currentPending)
    }
  }

  // Get a specific mutation by ID
  async getById(id: string): Promise<MutationQueueEntry | null> {
    const entries = await this.db
      .select()
      .from(mutationQueue)
      .where(eq(mutationQueue.id, id))
      .limit(1)

    return entries[0] ?? null
  }

  // Get all mutations for a specific record
  async getByRecord(
    tableName: string,
    recordId: string
  ): Promise<MutationQueueEntry[]> {
    return this.db
      .select()
      .from(mutationQueue)
      .where(
        and(
          eq(mutationQueue.tableName, tableName),
          eq(mutationQueue.recordId, recordId)
        )
      )
      .orderBy(mutationQueue.createdAt)
  }

  // Remove completed mutations older than a given age
  async cleanupOlderThan(maxAgeMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString()

    // Get count of records to delete first
    const toDelete = await this.db
      .select()
      .from(mutationQueue)
      .where(
        and(
          eq(mutationQueue.status, MutationStatus.COMPLETED),
          lt(mutationQueue.createdAt, cutoff)
        )
      )

    // Delete the records
    await this.db
      .delete(mutationQueue)
      .where(
        and(
          eq(mutationQueue.status, MutationStatus.COMPLETED),
          lt(mutationQueue.createdAt, cutoff)
        )
      )

    return toDelete.length
  }

  // Clear all completed mutations
  async clearCompleted(): Promise<number> {
    // Get count first
    const toDelete = await this.db
      .select()
      .from(mutationQueue)
      .where(eq(mutationQueue.status, MutationStatus.COMPLETED))

    // Delete
    await this.db
      .delete(mutationQueue)
      .where(eq(mutationQueue.status, MutationStatus.COMPLETED))

    return toDelete.length
  }

  // Get failed mutations for review
  async getFailed(): Promise<MutationQueueEntry[]> {
    return this.db
      .select()
      .from(mutationQueue)
      .where(eq(mutationQueue.status, MutationStatus.FAILED))
      .orderBy(desc(mutationQueue.createdAt))
  }

  // Retry a failed mutation
  async retry(id: string): Promise<void> {
    await this.db
      .update(mutationQueue)
      .set({
        status: MutationStatus.PENDING,
        retryCount: 0,
        errorMessage: null,
      })
      .where(eq(mutationQueue.id, id))

    // Update localStorage backup
    if (this.config.enablePersistence) {
      const currentPending = await this.getPending(1000)
      persistQueueToStorage(currentPending)
    }
  }

  // Parse payload JSON
  parsePayload(entry: MutationQueueEntry): Record<string, unknown> | null {
    if (!entry.payload) return null
    try {
      return JSON.parse(entry.payload) as Record<string, unknown>
    } catch {
      return null
    }
  }

  // Force persist current state (call before app close)
  async forcePersist(): Promise<void> {
    if (!this.config.enablePersistence) return
    await this.persistQueue()
  }

  // Clear the backup (call when queue is empty)
  clearBackup(): void {
    clearQueueBackup()
  }
}

// Factory function for creating queue manager
export function createMutationQueueManager(
  db: DrizzleDB,
  config?: Partial<MutationQueueConfig>
): MutationQueueManager {
  return new MutationQueueManager(db, config)
}
