/**
 * Pure rules shared by the Sage bridge routes: which bridge identities report
 * heartbeats, how many requests one poll may claim, and the cutoffs that
 * expire stale claims and consumed request IDs. No database or network
 * access here.
 */

/** Every bridge process that records a heartbeat in sage_bridge_status. */
export const SAGE_BRIDGE_HEARTBEAT_IDS = [
  "client-project-writer",
  "pay-application-poller",
  "labor-hours-poller",
  "square-payment-writer",
  "tax-catalog-poller",
] as const

export type SageBridgeHeartbeatId = (typeof SAGE_BRIDGE_HEARTBEAT_IDS)[number]

/** Consumed bridge request IDs are kept this long to reject replays. */
export const SAGE_BRIDGE_NONCE_RETENTION_MS = 15 * 60 * 1000

/**
 * The batch size a bridge poll asked for (`?limit=`), clamped to 1..max.
 * A missing value uses `fallback`; a non-integer one also uses `fallback`.
 */
export function sageBridgeBatchLimit(requested: string | null, fallback: number, max: number): number {
  const value = Number(requested ?? String(fallback))
  return Number.isInteger(value) ? Math.min(max, Math.max(1, value)) : fallback
}

/** ISO timestamp `milliseconds` before `now`: claims or nonces older than this are stale. */
export function sageBridgeCutoff(now: Date, milliseconds: number): string {
  return new Date(now.getTime() - milliseconds).toISOString()
}
