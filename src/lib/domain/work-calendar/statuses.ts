/*
 * Enumerated values for this domain (architecture standard, section 3).
 * Pure constants with no imports, so the Drizzle schema can type its
 * columns with them.
 */

export const WORK_CALENDAR_EVENT_TYPES = [
  "meeting",
  "appointment",
  "inspection",
  "delivery",
  "company_event",
  "absence",
  "other",
] as const
export type WorkCalendarEventType = (typeof WORK_CALENDAR_EVENT_TYPES)[number]

export const WORK_CALENDAR_EVENT_VISIBILITIES = [
  "organization",
  "participants",
  "busy",
  "private",
] as const
