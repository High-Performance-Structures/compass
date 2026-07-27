export type WorkCalendarProjectIdentity = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
}

export type WorkCalendarSearchableEntry = {
  readonly projectLabel: string
  readonly projectName: string
  readonly title: string
  readonly status: string
  readonly priority: string
  readonly assignedTo: string | null
  readonly companyName: string | null
  readonly sourceLabel: string
}

export type WorkCalendarEventTimingInput = {
  readonly allDay: boolean
  readonly startDate: string
  readonly endDate: string
  readonly startTime: string
  readonly endTime: string
  readonly startsAt: string | null
  readonly endsAt: string | null
  readonly timeZone: string
}

export type WorkCalendarEventTiming =
  | {
      readonly success: true
      readonly startDate: string | null
      readonly endDateExclusive: string | null
      readonly startsAt: string | null
      readonly endsAt: string | null
      readonly timeZone: string
    }
  | {
      readonly success: false
      readonly error: string
    }

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const TIME_KEY_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/

function isRealDateKey(value: string): boolean {
  if (!DATE_KEY_PATTERN.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  )
}

function addDateKeyDays(value: string, days: number): string {
  const parsed = new Date(`${value}T12:00:00Z`)
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return parsed.toISOString().slice(0, 10)
}

function isCanonicalInstant(value: string): boolean {
  const parsed = new Date(value)
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString() === value
  )
}

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0))
    return true
  } catch {
    return false
  }
}

function localDateTimeInZone(
  instant: string,
  timeZone: string
): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(instant))
    const values = new Map(
      parts.map((part) => [part.type, part.value])
    )
    const year = values.get("year")
    const month = values.get("month")
    const day = values.get("day")
    const hour = values.get("hour")
    const minute = values.get("minute")
    if (!year || !month || !day || !hour || !minute) return null
    return `${year}-${month}-${day}T${hour}:${minute}`
  } catch {
    return null
  }
}

export type LocalDateTimeResolution =
  | {
      readonly success: true
      readonly instant: string
      readonly ambiguous: boolean
    }
  | {
      readonly success: false
      readonly error: string
    }

export function instantForLocalDateTime(
  date: string,
  time: string,
  timeZone: string
): LocalDateTimeResolution {
  if (!isRealDateKey(date) || !TIME_KEY_PATTERN.test(time)) {
    return { success: false, error: "Enter a valid date and time." }
  }

  const zone = timeZone.trim()
  const target = `${date}T${time}`
  const [year, month, day] = date.split("-").map(Number)
  const [hour, minute] = time.split(":").map(Number)
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined
  ) {
    return { success: false, error: "Enter a valid date and time." }
  }

  // Searching possible UTC offsets avoids relying on the device's own time
  // zone. Fifteen-minute increments cover every currently used IANA offset,
  // including half-hour and 45-minute regions.
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute)
  const matches: string[] = []
  for (
    let offsetMinutes = -14 * 60;
    offsetMinutes <= 14 * 60;
    offsetMinutes += 15
  ) {
    const instant = new Date(
      localAsUtc - offsetMinutes * 60_000
    ).toISOString()
    if (localDateTimeInZone(instant, zone) === target) matches.push(instant)
  }

  if (matches.length === 0) {
    return {
      success: false,
      error: "That local time does not exist in the selected time zone.",
    }
  }

  matches.sort()
  const firstMatch = matches[0]
  if (!firstMatch) {
    return {
      success: false,
      error: "That local time could not be resolved.",
    }
  }

  return {
    success: true,
    instant: firstMatch,
    ambiguous: matches.length > 1,
  }
}

export function dateKeyInTimeZone(
  instant: Date,
  timeZone: string
): string {
  const iso = instant.toISOString()
  const local = localDateTimeInZone(iso, timeZone)
  return local?.slice(0, 10) ?? iso.slice(0, 10)
}

export function inclusiveEndDateFromExclusive(
  endDateExclusive: string
): string {
  return addDateKeyDays(endDateExclusive, -1)
}

export function normalizeWorkCalendarEventTiming(
  input: WorkCalendarEventTimingInput
): WorkCalendarEventTiming {
  if (!isRealDateKey(input.startDate) || !isRealDateKey(input.endDate)) {
    return { success: false, error: "Enter valid event dates." }
  }

  if (input.endDate < input.startDate) {
    return {
      success: false,
      error: "End date must be on or after the start date.",
    }
  }

  const timeZone = input.timeZone.trim()
  if (
    timeZone.length === 0 ||
    timeZone.length > 100 ||
    !isValidTimeZone(timeZone)
  ) {
    return {
      success: false,
      error: "The event time zone is invalid.",
    }
  }

  if (input.allDay) {
    return {
      success: true,
      startDate: input.startDate,
      endDateExclusive: addDateKeyDays(input.endDate, 1),
      startsAt: null,
      endsAt: null,
      timeZone,
    }
  }

  if (
    !TIME_KEY_PATTERN.test(input.startTime) ||
    !TIME_KEY_PATTERN.test(input.endTime)
  ) {
    return { success: false, error: "Enter valid start and end times." }
  }

  if (
    !input.startsAt ||
    !input.endsAt ||
    !isCanonicalInstant(input.startsAt) ||
    !isCanonicalInstant(input.endsAt)
  ) {
    return {
      success: false,
      error: "The timed event could not be resolved in its time zone.",
    }
  }

  if (
    localDateTimeInZone(input.startsAt, timeZone) !==
      `${input.startDate}T${input.startTime}` ||
    localDateTimeInZone(input.endsAt, timeZone) !==
      `${input.endDate}T${input.endTime}`
  ) {
    return {
      success: false,
      error:
        "One of these local times does not exist in the selected time zone.",
    }
  }

  if (input.endsAt <= input.startsAt) {
    return {
      success: false,
      error: "A timed event must end after it starts.",
    }
  }

  return {
    success: true,
    startDate: null,
    endDateExclusive: null,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    timeZone,
  }
}

export function normalizeWorkCalendarSearch(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function workCalendarEntryMatches(
  entry: WorkCalendarSearchableEntry,
  query: string
): boolean {
  const normalizedQuery = normalizeWorkCalendarSearch(query)
  if (!normalizedQuery) return true

  const haystack = normalizeWorkCalendarSearch(
    [
      entry.projectLabel,
      entry.projectName,
      entry.title,
      entry.status,
      entry.priority,
      entry.assignedTo,
      entry.companyName,
      entry.sourceLabel,
    ]
      .filter((value): value is string => Boolean(value))
      .join(" ")
  )

  return haystack.includes(normalizedQuery)
}

export function resolveHOfficeProjectId(
  projects: readonly WorkCalendarProjectIdentity[]
): string | null {
  const matches = projects.filter((project) => {
    const names = [project.name, project.projectNumber]
      .filter((value): value is string => Boolean(value))
      .map(normalizeWorkCalendarSearch)

    return names.some(
      (value) => value === "h office" || value === "h office project"
    )
  })

  return matches.length === 1 ? matches[0]?.id ?? null : null
}

export function scheduleItemHref(projectId: string, itemId: string): string {
  return `/dashboard/projects/${encodeURIComponent(projectId)}/schedule?view=list&item=${encodeURIComponent(itemId)}#schedule-item-${encodeURIComponent(itemId)}`
}

export function projectTodoHref(projectId: string, itemId: string): string {
  return `/dashboard/projects/${encodeURIComponent(projectId)}/todos?item=${encodeURIComponent(itemId)}#todo-${encodeURIComponent(itemId)}`
}
