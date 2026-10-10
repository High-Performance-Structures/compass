/**
 * Message Desk triage follows common help-desk practice: every message has an
 * owner and a status, a first response is expected within a business day, and
 * open messages with no activity are flagged as they age so nothing sits
 * unanswered without anyone noticing.
 */
export const STAFF_MESSAGE_STATUSES = ["new", "in_progress", "waiting", "resolved"] as const
export type StaffMessageStatus = (typeof STAFF_MESSAGE_STATUSES)[number]

export const STAFF_MESSAGE_STATUS_LABEL: Readonly<Record<StaffMessageStatus, string>> = {
  new: "New",
  in_progress: "In progress",
  waiting: "Waiting on caller",
  resolved: "Resolved",
}

export function isStaffMessageStatus(value: string): value is StaffMessageStatus {
  return STAFF_MESSAGE_STATUSES.some((status) => status === value)
}

export function staffMessageStatus(value: string): StaffMessageStatus {
  return isStaffMessageStatus(value) ? value : "new"
}

/** Business-day targets. Kept together so they can become an org setting. */
export const STAFF_MESSAGE_AGING = {
  /** A new message should get a first response within this many business days. */
  firstResponseDays: 1,
  /** An open message with no activity for this long is flagged as aging. */
  agingDays: 2,
  /** …and as stale after this long. */
  staleDays: 5,
} as const

export type StaffMessageAgingLevel = "fresh" | "needs_response" | "aging" | "stale"

export const STAFF_MESSAGE_AGING_LABEL: Readonly<Record<StaffMessageAgingLevel, string>> = {
  fresh: "On track",
  needs_response: "Needs first response",
  aging: "Aging",
  stale: "Stale",
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Elapsed business days (weekends skipped), fractional, capped at 90. */
export function businessDaysBetween(fromIso: string, to: Date): number {
  const from = new Date(fromIso)
  if (Number.isNaN(from.getTime()) || to <= from) return 0
  let elapsed = 0
  let cursor = from.getTime()
  const end = to.getTime()
  while (cursor < end && elapsed < 90) {
    const day = new Date(cursor)
    const nextMidnight = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + 1)
    const sliceEnd = Math.min(nextMidnight, end)
    const weekday = day.getUTCDay()
    if (weekday !== 0 && weekday !== 6) elapsed += (sliceEnd - cursor) / DAY_MS
    cursor = sliceEnd
  }
  return elapsed
}

export type StaffMessageAging = {
  readonly level: StaffMessageAgingLevel
  /** Business days since the last activity on the message. */
  readonly idleDays: number
}

/** How urgently a message needs attention, from its status and last activity. */
export function staffMessageAging(
  message: {
    readonly status: StaffMessageStatus
    readonly createdAt: string
    readonly lastActivityAt: string
  },
  now: Date,
): StaffMessageAging {
  const idleDays = businessDaysBetween(message.lastActivityAt, now)
  if (message.status === "resolved") return { level: "fresh", idleDays }
  if (idleDays >= STAFF_MESSAGE_AGING.staleDays) return { level: "stale", idleDays }
  if (idleDays >= STAFF_MESSAGE_AGING.agingDays) return { level: "aging", idleDays }
  if (message.status === "new" && businessDaysBetween(message.createdAt, now) >= STAFF_MESSAGE_AGING.firstResponseDays) {
    return { level: "needs_response", idleDays }
  }
  return { level: "fresh", idleDays }
}

/** Plain-words idle time, e.g. "3 business days". */
export function idleLabel(idleDays: number): string {
  if (idleDays < 1) return "today"
  const whole = Math.floor(idleDays)
  return `${whole} business ${whole === 1 ? "day" : "days"}`
}
