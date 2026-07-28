export type GanttScrollAxis = "horizontal" | "vertical"

interface WheelDelta {
  readonly deltaX: number
  readonly deltaY: number
}

export function dominantScrollAxis(
  deltaX: number,
  deltaY: number
): GanttScrollAxis | null {
  const horizontalDistance = Math.abs(deltaX)
  const verticalDistance = Math.abs(deltaY)

  if (horizontalDistance === 0 && verticalDistance === 0) return null
  return horizontalDistance > verticalDistance ? "horizontal" : "vertical"
}

export function lockWheelToDominantAxis(
  deltaX: number,
  deltaY: number
): WheelDelta {
  const axis = dominantScrollAxis(deltaX, deltaY)
  if (axis === "horizontal") {
    return { deltaX, deltaY: 0 }
  }
  if (axis === "vertical") {
    return { deltaX: 0, deltaY }
  }
  return { deltaX: 0, deltaY: 0 }
}

export function normalizeWheelDelta(
  delta: number,
  deltaMode: number,
  pageSize: number
): number {
  if (deltaMode === 1) return delta * 16
  if (deltaMode === 2) return delta * pageSize
  return delta
}
