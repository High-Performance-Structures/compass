import "server-only"

import { inArray } from "drizzle-orm"

import { sageCostCodes } from "@/db/schema"
import { sageBridgeStatus } from "@/db/schema-sage"
import { sageCostCodeSyncBatches } from "@/lib/domain/sage-bridge/cost-code-store"
import { planSageCostCodeSync, type SageCostCodeRecord } from "@/lib/domain/sage-bridge/cost-code-sync-rules"
import { sageBridgeHeartbeatStatement } from "@/lib/domain/sage-bridge/store"
import { SAGE_ESTIMATE_COST_CODE_CATALOG } from "@/lib/estimates/sage-estimate-cost-code-catalog"
import type { Db } from "@/lib/server/action-context"

/*
 * Keeps sage_cost_codes the same as Sage's cost code list. The private,
 * read-only Sage reader asks every few minutes whether a read is due (an
 * hour since the last one, or someone pressed "Refresh from Sage"), reads
 * dbo.cstcde when it is, and posts the complete list; Compass works out what
 * changed and writes only that.
 */

/** How often the catalog is read from Sage without anyone asking. */
const SAGE_COST_CODE_SYNC_INTERVAL_MS = 60 * 60 * 1000
/** A reader heartbeat older than this means the reader isn't running. */
const READER_STALE_MS = 30 * 60 * 1000

export type SageCostCodeSyncState = {
  readonly lastSyncedAt: string | null
  readonly refreshRequestedAt: string | null
  readonly readerLastSeenAt: string | null
}

export async function loadSageCostCodeSyncState(db: Db): Promise<SageCostCodeSyncState> {
  const rows = await db
    .select({ id: sageBridgeStatus.id, lastSeenAt: sageBridgeStatus.lastSeenAt })
    .from(sageBridgeStatus)
    .where(inArray(sageBridgeStatus.id, ["cost-code-sync", "cost-code-refresh-request", "cost-code-reader"]))
  const at = (id: string): string | null => rows.find((row) => row.id === id)?.lastSeenAt ?? null
  return { lastSyncedAt: at("cost-code-sync"), refreshRequestedAt: at("cost-code-refresh-request"), readerLastSeenAt: at("cost-code-reader") }
}

/** Whether the reader should read Sage now, and why. */
export function sageCostCodeSyncDue(state: SageCostCodeSyncState, now: Date): { readonly due: boolean; readonly reason: string } {
  if (!state.lastSyncedAt) return { due: true, reason: "never_synced" }
  if (state.refreshRequestedAt && state.refreshRequestedAt > state.lastSyncedAt) return { due: true, reason: "refresh_requested" }
  const age = now.getTime() - Date.parse(state.lastSyncedAt)
  if (!Number.isFinite(age) || age >= SAGE_COST_CODE_SYNC_INTERVAL_MS) return { due: true, reason: "interval" }
  return { due: false, reason: "up_to_date" }
}

export function sageCostCodeReaderRunning(state: SageCostCodeSyncState, now: Date): boolean {
  const seen = state.readerLastSeenAt ? Date.parse(state.readerLastSeenAt) : Number.NaN
  return Number.isFinite(seen) && now.getTime() - seen <= READER_STALE_MS
}

export type SageCostCodeSyncSummary = {
  readonly inserted: number
  readonly updated: number
  readonly inactivated: number
  readonly unchanged: number
  readonly skipped: number
  readonly warnings: readonly string[]
}

/** Applies Sage's complete cost code list. Nothing is written when the read looks incomplete. */
export async function applySageCostCodeSnapshot(
  db: Db,
  database: D1Database,
  records: readonly SageCostCodeRecord[],
  now: string
): Promise<{ readonly success: true; readonly summary: SageCostCodeSyncSummary } | { readonly success: false; readonly error: string }> {
  const existing = await db.select().from(sageCostCodes)
  const divisionNames = new Map(SAGE_ESTIMATE_COST_CODE_CATALOG.map(([, , code, name]) => [code, name]))
  const planned = planSageCostCodeSync({ records, existing, divisionNames })
  if (!planned.success) return planned
  const { plan } = planned
  // Small batches in order; a failed batch leaves the rest for the next read,
  // which converges because every write is keyed by id and idempotent.
  for (const batch of sageCostCodeSyncBatches(db, plan, now)) {
    const [first, ...rest] = batch
    if (first) await db.batch([first, ...rest])
  }
  await sageBridgeHeartbeatStatement(database, "cost-code-sync", now).run()
  return {
    success: true,
    summary: {
      inserted: plan.inserts.length,
      updated: plan.updates.length,
      inactivated: plan.inactivations.length,
      unchanged: plan.unchanged,
      skipped: plan.skipped,
      warnings: plan.warnings,
    },
  }
}

/** Asks the reader to read Sage on its next check (within a few minutes). */
export async function requestSageCostCodeRefresh(database: D1Database, now: string): Promise<void> {
  await sageBridgeHeartbeatStatement(database, "cost-code-refresh-request", now).run()
}
