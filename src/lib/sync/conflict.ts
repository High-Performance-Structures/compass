// Conflict detection and resolution for sync operations
import {
  VectorClock,
  type VectorClockValue,
  compareClocks,
} from "./clock"

// Resolution strategies
export const ConflictStrategy = {
  NEWEST_WINS: "newest_wins",
  LOCAL_WINS: "local_wins",
  REMOTE_WINS: "remote_wins",
  MANUAL_REVIEW: "manual_review",
} as const

export type ConflictStrategyType =
  (typeof ConflictStrategy)[keyof typeof ConflictStrategy]

// Result of conflict detection
export interface ConflictDetectionResult {
  hasConflict: boolean
  localClock: VectorClockValue
  remoteClock: VectorClockValue
  comparison: "before" | "after" | "concurrent" | "equal"
}

// Result of conflict resolution
export interface ConflictResolutionResult<T = Record<string, unknown>> {
  resolution: "use_local" | "use_remote" | "merge" | "flag_manual"
  data?: T
  localData?: T
  remoteData?: T
  reason: string
}

// Conflict metadata stored in the database
export interface ConflictData<T = Record<string, unknown>> {
  local: T
  remote: T
  localClock: VectorClockValue
  remoteClock: VectorClockValue
  localModifiedAt: string
  remoteModifiedAt: string
  detectedAt: string
  reason: string
}

// Detect if there's a conflict between local and remote versions
export function detectConflict(
  localClockJson: string,
  remoteClockJson: string
): ConflictDetectionResult {
  const localClock = parseClockSafe(localClockJson)
  const remoteClock = parseClockSafe(remoteClockJson)

  const localVC = new VectorClock(localClock)
  const comparison = localVC.compare(remoteClock)

  // A conflict exists when clocks are concurrent
  // (both have changes that the other doesn't know about)
  const hasConflict = comparison === "concurrent"

  return {
    hasConflict,
    localClock,
    remoteClock,
    comparison,
  }
}

// Resolve conflict based on strategy
export function resolveConflict<T = Record<string, unknown>>(
  strategy: ConflictStrategyType,
  localData: T,
  remoteData: T,
  localClock: VectorClockValue,
  remoteClock: VectorClockValue,
  localModifiedAt: string | null,
  remoteModifiedAt: string | null
): ConflictResolutionResult<T> {
  switch (strategy) {
    case ConflictStrategy.LOCAL_WINS:
      return {
        resolution: "use_local",
        data: localData,
        reason: "Local wins strategy applied",
      }

    case ConflictStrategy.REMOTE_WINS:
      return {
        resolution: "use_remote",
        data: remoteData,
        reason: "Remote wins strategy applied",
      }

    case ConflictStrategy.MANUAL_REVIEW:
      return {
        resolution: "flag_manual",
        localData,
        remoteData,
        reason: "Flagged for manual review per strategy",
      }

    case ConflictStrategy.NEWEST_WINS: {
      // Compare timestamps
      if (!localModifiedAt && !remoteModifiedAt) {
        // No timestamps, compare vector clocks
        const comparison = compareClocks(localClock, remoteClock)
        if (comparison === "after") {
          return {
            resolution: "use_local",
            data: localData,
            reason: "Local clock is ahead",
          }
        }
        return {
          resolution: "use_remote",
          data: remoteData,
          reason: "Remote clock is ahead or equal (default)",
        }
      }

      if (!localModifiedAt) {
        return {
          resolution: "use_remote",
          data: remoteData,
          reason: "No local timestamp available",
        }
      }

      if (!remoteModifiedAt) {
        return {
          resolution: "use_local",
          data: localData,
          reason: "No remote timestamp available",
        }
      }

      const localTime = new Date(localModifiedAt).getTime()
      const remoteTime = new Date(remoteModifiedAt).getTime()

      if (remoteTime >= localTime) {
        return {
          resolution: "use_remote",
          data: remoteData,
          reason: `Remote is newer (${remoteModifiedAt} >= ${localModifiedAt})`,
        }
      }

      return {
        resolution: "use_local",
        data: localData,
        reason: `Local is newer (${localModifiedAt} > ${remoteModifiedAt})`,
      }
    }
  }
}

// Create conflict data for storage
export function createConflictData<T = Record<string, unknown>>(
  local: T,
  remote: T,
  localClock: VectorClockValue,
  remoteClock: VectorClockValue,
  localModifiedAt: string,
  remoteModifiedAt: string,
  reason: string
): ConflictData<T> {
  return {
    local,
    remote,
    localClock,
    remoteClock,
    localModifiedAt,
    remoteModifiedAt,
    detectedAt: new Date().toISOString(),
    reason,
  }
}

// Serialize conflict data for database storage
export function serializeConflictData<T = Record<string, unknown>>(
  data: ConflictData<T>
): string {
  return JSON.stringify(data)
}

// Parse conflict data from database
export function parseConflictData<T = Record<string, unknown>>(
  json: string
): ConflictData<T> | null {
  try {
    return JSON.parse(json) as ConflictData<T>
  } catch {
    return null
  }
}

// Helper to safely parse clock JSON
function parseClockSafe(json: string): VectorClockValue {
  try {
    return JSON.parse(json) as VectorClockValue
  } catch {
    return {}
  }
}

// Check if a record needs manual resolution
export function needsManualResolution(
  syncStatus: string,
  conflictData: string | null
): boolean {
  return syncStatus === "conflict" && conflictData !== null
}

// Get conflict summary for display
export function getConflictSummary<T = Record<string, unknown>>(
  conflictDataJson: string
): {
  localModified: string
  remoteModified: string
  detectedAt: string
  reason: string
} | null {
  const data = parseConflictData<T>(conflictDataJson)
  if (!data) return null

  return {
    localModified: data.localModifiedAt,
    remoteModified: data.remoteModifiedAt,
    detectedAt: data.detectedAt,
    reason: data.reason,
  }
}
