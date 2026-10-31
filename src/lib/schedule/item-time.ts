// Optional times on schedule items. Items are all-day unless a start time is
// set; times are 24-hour "HH:MM" strings in the project's local time.

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

type ScheduleItemTimes = Readonly<{
  startTime: string | null
  endTime: string | null
}>

export type ScheduleItemTimesResult =
  | ({ readonly success: true } & ScheduleItemTimes)
  | { readonly success: false; readonly error: string }

function cleanTime(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed.length > 0 ? trimmed : null
}

/** Checks optional start/end times; an end time needs a later start time. */
export function normalizeScheduleItemTimes(
  startTime: string | null | undefined,
  endTime: string | null | undefined
): ScheduleItemTimesResult {
  const start = cleanTime(startTime)
  const end = cleanTime(endTime)
  if (start !== null && !TIME_PATTERN.test(start)) {
    return { success: false, error: "Enter the start time as hours and minutes." }
  }
  if (end !== null && !TIME_PATTERN.test(end)) {
    return { success: false, error: "Enter the end time as hours and minutes." }
  }
  if (end !== null && start === null) {
    return { success: false, error: "Add a start time before an end time." }
  }
  if (start !== null && end !== null && end <= start) {
    return { success: false, error: "The end time must be after the start time." }
  }
  return { success: true, startTime: start, endTime: end }
}

/** "13:30" -> "1:30 PM". */
export function formatScheduleTime(value: string): string {
  const match = TIME_PATTERN.exec(value)
  if (!match) return value
  const hours = Number(match[1])
  const suffix = hours >= 12 ? "PM" : "AM"
  const hour12 = hours % 12 === 0 ? 12 : hours % 12
  return `${hour12}:${match[2]} ${suffix}`
}

/** "8:00 AM", "8:00 AM–4:30 PM", or null for an all-day item. */
export function scheduleItemTimeLabel(times: {
  readonly startTime?: string | null
  readonly endTime?: string | null
}): string | null {
  if (!times.startTime) return null
  const start = formatScheduleTime(times.startTime)
  return times.endTime ? `${start}–${formatScheduleTime(times.endTime)}` : start
}

/**
 * Local start and end ("YYYY-MM-DDTHH:MM:00") for a calendar event, or null
 * to keep the item all day. Only single-day items become timed events: a
 * multi-day item with a time would show as one block across every day.
 * Without an end time the event lasts an hour, ending by 23:59.
 */
export function scheduleItemTimedWindow(task: {
  readonly startDate: string
  readonly endDate: string
  readonly isMilestone: boolean
  readonly startTime?: string | null
  readonly endTime?: string | null
}): { readonly startsAt: string; readonly endsAt: string } | null {
  const times = normalizeScheduleItemTimes(task.startTime, task.endTime)
  if (!times.success || times.startTime === null) return null
  const day = task.isMilestone ? task.endDate : task.startDate
  if (!task.isMilestone && task.endDate !== task.startDate) return null
  const [hours, minutes] = times.startTime.split(":").map(Number)
  const endMinutes = Math.min(hours * 60 + minutes + 60, 23 * 60 + 59)
  const fallbackEnd = `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`
  return {
    startsAt: `${day}T${times.startTime}:00`,
    endsAt: `${day}T${times.endTime ?? fallbackEnd}:00`,
  }
}
