import type { ConflictStrategy } from "../client/types"

export interface ConflictResult {
  resolution: "use_local" | "use_remote" | "flag_manual"
  reason: string
}

export function resolveConflict(
  strategy: ConflictStrategy,
  localModified: string | null,
  remoteModified: string | null
): ConflictResult {
  switch (strategy) {
    case "remote_wins":
      return {
        resolution: "use_remote",
        reason: "Remote wins strategy applied",
      }

    case "local_wins":
      return {
        resolution: "use_local",
        reason: "Local wins strategy applied",
      }

    case "manual":
      return {
        resolution: "flag_manual",
        reason: "Flagged for manual review",
      }

    case "newest_wins": {
      if (!localModified && !remoteModified) {
        return {
          resolution: "use_remote",
          reason: "No timestamps available, defaulting to remote",
        }
      }
      if (!localModified) {
        return {
          resolution: "use_remote",
          reason: "No local timestamp",
        }
      }
      if (!remoteModified) {
        return {
          resolution: "use_local",
          reason: "No remote timestamp",
        }
      }

      const localTime = new Date(localModified).getTime()
      const remoteTime = new Date(remoteModified).getTime()

      if (remoteTime >= localTime) {
        return {
          resolution: "use_remote",
          reason: `Remote is newer (${remoteModified} >= ${localModified})`,
        }
      }
      return {
        resolution: "use_local",
        reason: `Local is newer (${localModified} > ${remoteModified})`,
      }
    }
  }
}
