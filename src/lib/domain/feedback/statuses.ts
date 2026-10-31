/*
 * Enumerated values for this domain (architecture standard, section 3).
 * Pure constants with no imports, so the Drizzle schema can type its
 * columns with them.
 */

export const FEEDBACK_DESK_STATUSES = [
  "new",
  "triaged",
  "needs_info",
  "planned",
  "in_progress",
  "testing",
  "deployed",
  "closed",
] as const
export type FeedbackDeskStatus = (typeof FEEDBACK_DESK_STATUSES)[number]

export const STAFF_MESSAGE_STATUSES = ["new", "follow_up_needed", "in_progress", "waiting_on_contact", "closed"] as const
export type StaffMessageStatus = (typeof STAFF_MESSAGE_STATUSES)[number]

export const FEEDBACK_TYPES = ["bug", "feature", "question", "general"] as const
