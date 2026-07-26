import type { TaskStatus } from "./types"

function clampPercent(percentComplete: number): number {
  if (!Number.isFinite(percentComplete)) return 0
  return Math.min(100, Math.max(0, Math.round(percentComplete)))
}

export function effectivePercentComplete(
  status: TaskStatus,
  percentComplete: number
): number {
  if (status === "COMPLETE") return 100
  return Math.min(99, clampPercent(percentComplete))
}

export function normalizeScheduleProgress(
  status: TaskStatus,
  percentComplete: number
): {
  readonly status: TaskStatus
  readonly percentComplete: number
} {
  return {
    status,
    percentComplete: effectivePercentComplete(status, percentComplete),
  }
}
