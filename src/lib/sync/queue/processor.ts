// Background sync processor
// Processes mutation queue on interval or online event
// Uses non-blocking backoff: entries have processAfter timestamp

import type { DrizzleDB } from "@/db/provider/interface"
import { MutationQueueManager, type MutationQueueConfig } from "./mutation-queue"
import { MutationStatus, type MutationQueueEntry, mutationQueue } from "../schema"
import { eq, and, or, lt, isNull } from "drizzle-orm"

// Processor configuration
export interface SyncProcessorConfig extends MutationQueueConfig {
  // Interval for background sync (milliseconds)
  syncIntervalMs: number
  // Whether to sync immediately when online
  syncOnOnline: boolean
  // Batch size for processing mutations
  batchSize: number
  // Exponential backoff base for retries
  backoffBaseMs: number
  // Maximum backoff time (5 minutes by default)
  maxBackoffMs: number
}

const DEFAULT_PROCESSOR_CONFIG: SyncProcessorConfig = {
  maxRetries: 5,
  retryDelayMs: 1000,
  syncIntervalMs: 30000, // 30 seconds
  syncOnOnline: true,
  batchSize: 10,
  backoffBaseMs: 1000,
  maxBackoffMs: 300000, // 5 minutes
  enablePersistence: true,
}

// Handler for processing individual mutations
// Returns true on success, false on failure
export type MutationHandler = (
  entry: MutationQueueEntry,
  payload: Record<string, unknown> | null
) => Promise<boolean>

// Sync status for reporting
export interface SyncProcessorStatus {
  isRunning: boolean
  lastSyncAt: string | null
  pendingCount: number
  processingCount: number
  failedCount: number
  waitingCount: number // Entries waiting for backoff
  lastError: string | null
}

export class SyncProcessor {
  private db: DrizzleDB
  private queueManager: MutationQueueManager
  private config: SyncProcessorConfig
  private handler: MutationHandler | null = null
  private intervalId: ReturnType<typeof setInterval> | null = null
  private isProcessing = false
  private lastSyncAt: string | null = null
  private lastError: string | null = null

  constructor(
    db: DrizzleDB,
    config?: Partial<SyncProcessorConfig>
  ) {
    this.db = db
    this.config = { ...DEFAULT_PROCESSOR_CONFIG, ...config }
    this.queueManager = new MutationQueueManager(db, this.config)
  }

  // Set the mutation handler
  setHandler(handler: MutationHandler): void {
    this.handler = handler
  }

  // Start background processing
  start(): void {
    if (this.intervalId !== null) return

    // Process immediately on start
    this.processQueue().catch((err) => {
      this.lastError = err instanceof Error ? err.message : "Unknown error"
    })

    // Set up interval
    this.intervalId = setInterval(() => {
      this.processQueue().catch((err) => {
        this.lastError = err instanceof Error ? err.message : "Unknown error"
      })
    }, this.config.syncIntervalMs)

    // Listen for online event if in browser
    if (typeof window !== "undefined" && this.config.syncOnOnline) {
      window.addEventListener("online", this.handleOnlineEvent)
    }
  }

  // Stop background processing
  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }

    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.handleOnlineEvent)
    }
  }

  // Get current status
  async getStatus(): Promise<SyncProcessorStatus> {
    const now = new Date().toISOString()

    // Count pending entries (no processAfter or processAfter has passed)
    const pendingResult = await this.db
      .select()
      .from(mutationQueue)
      .where(
        and(
          eq(mutationQueue.status, MutationStatus.PENDING),
          or(
            isNull(mutationQueue.processAfter),
            lt(mutationQueue.processAfter, now)
          )
        )
      )

    // Count processing entries
    const processingResult = await this.db
      .select()
      .from(mutationQueue)
      .where(eq(mutationQueue.status, MutationStatus.PROCESSING))

    // Count failed entries
    const failedResult = await this.db
      .select()
      .from(mutationQueue)
      .where(eq(mutationQueue.status, MutationStatus.FAILED))

    // Count waiting entries (pending but processAfter is in the future)
    const waitingResult = await this.db
      .select()
      .from(mutationQueue)
      .where(
        and(
          eq(mutationQueue.status, MutationStatus.PENDING),
          lt(mutationQueue.processAfter, now)
        )
      )

    return {
      isRunning: this.intervalId !== null,
      lastSyncAt: this.lastSyncAt,
      pendingCount: pendingResult.length,
      processingCount: processingResult.length,
      failedCount: failedResult.length,
      waitingCount: waitingResult.length,
      lastError: this.lastError,
    }
  }

  // Process the queue with non-blocking backoff
  async processQueue(): Promise<ProcessResult> {
    if (this.isProcessing) {
      return { processed: 0, succeeded: 0, failed: 0, skipped: true }
    }

    if (!this.handler) {
      return { processed: 0, succeeded: 0, failed: 0, skipped: true }
    }

    // Check if online (browser only)
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      return { processed: 0, succeeded: 0, failed: 0, skipped: true }
    }

    this.isProcessing = true
    this.lastError = null

    let processed = 0
    let succeeded = 0
    let failed = 0

    try {
      // Get entries that are ready to process (no processAfter or processAfter has passed)
      const readyEntries = await this.getReadyEntries(this.config.batchSize)

      for (const entry of readyEntries) {
        // Mark as processing
        await this.db
          .update(mutationQueue)
          .set({ status: MutationStatus.PROCESSING })
          .where(eq(mutationQueue.id, entry.id))

        processed++

        const payload = entry.payload
          ? (JSON.parse(entry.payload) as Record<string, unknown>)
          : null

        try {
          const success = await this.handler(entry, payload)

          if (success) {
            await this.queueManager.markCompleted(entry.id)
            succeeded++
          } else {
            await this.handleFailure(entry, "Handler returned false")
            failed++
          }
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : "Unknown error"
          await this.handleFailure(entry, errorMessage)
          failed++
        }
      }

      if (processed > 0) {
        this.lastSyncAt = new Date().toISOString()
      }
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : "Unknown error"
    } finally {
      this.isProcessing = false
    }

    return { processed, succeeded, failed, skipped: false }
  }

  // Get entries that are ready to be processed (non-blocking backoff)
  // An entry is ready if it's pending AND (no processAfter OR processAfter <= now)
  private async getReadyEntries(limit: number): Promise<MutationQueueEntry[]> {
    const now = new Date().toISOString()

    return this.db
      .select()
      .from(mutationQueue)
      .where(
        and(
          eq(mutationQueue.status, MutationStatus.PENDING),
          or(
            isNull(mutationQueue.processAfter),
            lt(mutationQueue.processAfter, now)
          )
        )
      )
      .limit(limit)
  }

  // Handle failure with non-blocking backoff
  // Sets processAfter timestamp instead of blocking
  private async handleFailure(
    entry: MutationQueueEntry,
    error: string
  ): Promise<void> {
    const newRetryCount = entry.retryCount + 1
    const shouldRetry = newRetryCount < this.config.maxRetries

    if (shouldRetry) {
      // Calculate exponential backoff
      const backoffMs = this.calculateBackoff(newRetryCount)
      const processAfter = new Date(Date.now() + backoffMs).toISOString()

      // Set status back to pending with processAfter timestamp
      await this.db
        .update(mutationQueue)
        .set({
          status: MutationStatus.PENDING,
          retryCount: newRetryCount,
          errorMessage: error,
          processAfter,
        })
        .where(eq(mutationQueue.id, entry.id))
    } else {
      // Max retries exceeded, mark as failed
      await this.db
        .update(mutationQueue)
        .set({
          status: MutationStatus.FAILED,
          retryCount: newRetryCount,
          errorMessage: error,
        })
        .where(eq(mutationQueue.id, entry.id))
    }

    // Update localStorage backup if persistence is enabled
    if (this.config.enablePersistence) {
      await this.queueManager.forcePersist()
    }
  }

  // Force immediate sync (ignores backoff)
  async forceSync(): Promise<ProcessResult> {
    if (this.isProcessing) {
      return { processed: 0, succeeded: 0, failed: 0, skipped: true }
    }

    if (!this.handler) {
      return { processed: 0, succeeded: 0, failed: 0, skipped: true }
    }

    // Check if online (browser only)
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      return { processed: 0, succeeded: 0, failed: 0, skipped: true }
    }

    this.isProcessing = true
    this.lastError = null

    let processed = 0
    let succeeded = 0
    let failed = 0

    try {
      // Get ALL pending entries, ignoring processAfter
      const allPending = await this.db
        .select()
        .from(mutationQueue)
        .where(eq(mutationQueue.status, MutationStatus.PENDING))
        .limit(this.config.batchSize)

      for (const entry of allPending) {
        // Mark as processing
        await this.db
          .update(mutationQueue)
          .set({ status: MutationStatus.PROCESSING })
          .where(eq(mutationQueue.id, entry.id))

        processed++

        const payload = entry.payload
          ? (JSON.parse(entry.payload) as Record<string, unknown>)
          : null

        try {
          const success = await this.handler(entry, payload)

          if (success) {
            await this.queueManager.markCompleted(entry.id)
            succeeded++
          } else {
            await this.handleFailure(entry, "Handler returned false")
            failed++
          }
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : "Unknown error"
          await this.handleFailure(entry, errorMessage)
          failed++
        }
      }

      if (processed > 0) {
        this.lastSyncAt = new Date().toISOString()
      }
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : "Unknown error"
    } finally {
      this.isProcessing = false
    }

    return { processed, succeeded, failed, skipped: false }
  }

  // Reset backoff for all waiting entries (call when connection is restored)
  async resetBackoff(): Promise<number> {
    const result = await this.db
      .update(mutationQueue)
      .set({ processAfter: null })
      .where(
        and(
          eq(mutationQueue.status, MutationStatus.PENDING),
          lt(mutationQueue.processAfter, new Date().toISOString())
        )
      )

    return result.changes ?? 0
  }

  // Calculate exponential backoff with cap
  private calculateBackoff(retryCount: number): number {
    const backoff = this.config.backoffBaseMs * Math.pow(2, retryCount - 1)
    return Math.min(backoff, this.config.maxBackoffMs)
  }

  // Handle online event
  private handleOnlineEvent = (): void => {
    // Reset backoff when coming online
    this.resetBackoff().catch(() => {
      // Ignore errors
    })

    this.processQueue().catch((err) => {
      this.lastError = err instanceof Error ? err.message : "Unknown error"
    })
  }
}

export interface ProcessResult {
  processed: number
  succeeded: number
  failed: number
  skipped: boolean // Skipped due to already processing or offline
}

// Factory function
export function createSyncProcessor(
  db: DrizzleDB,
  config?: Partial<SyncProcessorConfig>
): SyncProcessor {
  return new SyncProcessor(db, config)
}
