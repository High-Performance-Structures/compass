export type GanttScrollAxis = "horizontal" | "vertical"

interface WheelDelta {
  readonly deltaX: number
  readonly deltaY: number
}

interface ScheduleRowDateRange {
  readonly startDate: string
  readonly endDate: string
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

export function synchronizedScrollTop(
  sourceTop: number,
  sourceScrollHeight: number,
  sourceClientHeight: number,
  targetScrollHeight: number,
  targetClientHeight: number
): number {
  const sourceRange = Math.max(0, sourceScrollHeight - sourceClientHeight)
  const targetRange = Math.max(0, targetScrollHeight - targetClientHeight)
  if (sourceRange === 0 || targetRange === 0) return 0
  const progress = Math.min(1, Math.max(0, sourceTop / sourceRange))
  return progress * targetRange
}

export function paddingToIncludeDate(
  startDate: string,
  endDate: string,
  targetDate: string,
  basePaddingDays: number
): [string, string] {
  const parseCalendarDate = (value: string): number => {
    const [year = 0, month = 1, day = 1] = value.split("-").map(Number)
    return Date.UTC(year, month - 1, day)
  }
  const start = parseCalendarDate(startDate)
  const end = parseCalendarDate(endDate)
  const target = parseCalendarDate(targetDate)
  const millisecondsPerDay = 86_400_000
  const daysBefore = Math.max(
    0,
    Math.ceil((start - target) / millisecondsPerDay)
  )
  const daysAfter = Math.max(
    0,
    Math.ceil((target - end) / millisecondsPerDay)
  )
  return [
    `${basePaddingDays + daysBefore}d`,
    `${basePaddingDays + daysAfter}d`,
  ]
}

export function ganttRowIndexForScrollTop(
  scrollTop: number,
  itemCount: number,
  headerHeight = 85,
  rowHeight = 48
): number | null {
  if (itemCount === 0) return null
  const rowOffset = Math.max(0, scrollTop - headerHeight)
  return Math.min(itemCount - 1, Math.floor(rowOffset / rowHeight))
}

export function nearestScheduleRowIndexForDate(
  rows: readonly ScheduleRowDateRange[],
  targetDate: string
): number | null {
  let nextIndex: number | null = null
  let nextStart: string | null = null
  let previousIndex: number | null = null
  let previousEnd: string | null = null

  for (const [index, row] of rows.entries()) {
    if (row.startDate <= targetDate && row.endDate >= targetDate) {
      return index
    }
    if (
      row.startDate > targetDate &&
      (nextStart === null || row.startDate < nextStart)
    ) {
      nextIndex = index
      nextStart = row.startDate
    }
    if (
      row.endDate < targetDate &&
      (previousEnd === null || row.endDate > previousEnd)
    ) {
      previousIndex = index
      previousEnd = row.endDate
    }
  }

  return nextIndex ?? previousIndex
}

export function centeredGanttRowScrollTop(input: {
  readonly rowIndex: number
  readonly clientHeight: number
  readonly scrollHeight: number
  readonly headerHeight?: number
  readonly rowHeight?: number
}): number {
  const headerHeight = input.headerHeight ?? 85
  const rowHeight = input.rowHeight ?? 48
  const rowCenter =
    headerHeight + input.rowIndex * rowHeight + rowHeight / 2
  const desiredTop = rowCenter - input.clientHeight / 2
  const maximumTop = Math.max(0, input.scrollHeight - input.clientHeight)
  return Math.max(0, Math.min(desiredTop, maximumTop))
}

export function centeredTimelineScrollLeft(input: {
  readonly dayOffset: number
  readonly dayWidth: number
  readonly labelWidth: number
  readonly clientWidth: number
  readonly scrollWidth: number
}): number {
  const visibleTimelineWidth = Math.max(
    0,
    input.clientWidth - input.labelWidth
  )
  const dateCenter =
    input.dayOffset * input.dayWidth + input.dayWidth / 2
  const desiredScrollLeft = dateCenter - visibleTimelineWidth / 2
  const maximumScrollLeft = Math.max(
    0,
    input.scrollWidth - input.clientWidth
  )
  return Math.max(0, Math.min(desiredScrollLeft, maximumScrollLeft))
}
