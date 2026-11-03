/**
 * The only code that writes the desktop offline mutation queue (architecture
 * standard, section 1). The queue lives in the desktop app's local SQLite
 * database, not D1, and this module ships in the desktop client bundle, so it
 * is kept apart from the settings store and imports only the sync schema.
 * The queue manager and processor in src/lib/sync/queue decide what to write.
 */
import { and, eq, lt } from "drizzle-orm"

import type { DrizzleDB } from "@/db/provider/interface"
import {
  mutationQueue,
  MutationStatus,
  type MutationStatusType,
  type NewMutationQueueEntry,
} from "@/lib/sync/schema"


export async function insertQueuedMutation(db: DrizzleDB, entry: NewMutationQueueEntry): Promise<void> {
  await db.insert(mutationQueue).values(entry)
}

export async function setQueuedMutationStatus(db: DrizzleDB, id: string, status: MutationStatusType): Promise<void> {
  await db.update(mutationQueue).set({ status }).where(eq(mutationQueue.id, id))
}

/** Records a failed attempt: retry state, error, and (optionally) when to try again. */
export async function updateQueuedMutationAttempt(
  db: DrizzleDB,
  id: string,
  values: {
    readonly status: MutationStatusType
    readonly retryCount: number
    readonly errorMessage: string | null
    readonly processAfter?: string
  },
): Promise<void> {
  await db.update(mutationQueue).set(values).where(eq(mutationQueue.id, id))
}

/** Deletes completed entries, only those created before `createdBefore` when given. */
export async function deleteCompletedMutations(db: DrizzleDB, createdBefore?: string): Promise<void> {
  await db
    .delete(mutationQueue)
    .where(
      createdBefore === undefined
        ? eq(mutationQueue.status, MutationStatus.COMPLETED)
        : and(eq(mutationQueue.status, MutationStatus.COMPLETED), lt(mutationQueue.createdAt, createdBefore)),
    )
}

/** Clears the backoff of pending entries due before `before`; returns how many changed. */
export async function clearQueuedMutationBackoff(db: DrizzleDB, before: string): Promise<number> {
  const result = await db
    .update(mutationQueue)
    .set({ processAfter: null })
    .where(and(eq(mutationQueue.status, MutationStatus.PENDING), lt(mutationQueue.processAfter, before)))
  return result.changes ?? 0
}
