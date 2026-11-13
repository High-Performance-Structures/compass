/*
 * Enumerated values for this domain (architecture standard, section 3).
 * Pure constants with no imports, so the Drizzle schema can type its
 * columns with them.
 */

export const SCHEDULE_LINK_TYPES = [
  "file",
  "rfi",
  "conversation",
  "todo",
] as const
export type ScheduleLinkType = (typeof SCHEDULE_LINK_TYPES)[number]

/**
 * Who performs a schedule item's work ("Done by"): one of the company's
 * department codes (the same codes as PROJECT_DEPARTMENTS, which a test keeps
 * in step) or an outside trade. Null when not set.
 */
export const SCHEDULE_DONE_BY = ["O", "H", "N", "D", "outside"] as const
export type ScheduleDoneBy = (typeof SCHEDULE_DONE_BY)[number]

export const SCHEDULE_TASK_STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETE", "BLOCKED"] as const
export type TaskStatus = (typeof SCHEDULE_TASK_STATUSES)[number]

/** Finish-to-start, start-to-start, finish-to-finish, start-to-finish. */
export const DEPENDENCY_TYPES = ["FS", "SS", "FF", "SF"] as const
export type DependencyType = (typeof DEPENDENCY_TYPES)[number]

export const WORKDAY_EXCEPTION_TYPES = ["non_working", "working"] as const
export type WorkdayExceptionType = (typeof WORKDAY_EXCEPTION_TYPES)[number]

/**
 * Every resource_type a schedule link row may hold: the staff-created
 * SCHEDULE_LINK_TYPES plus Buildertrend provenance links written by cutover
 * imports ("buildertrend" by scripts/lib/o-58-3674-operational-cutover.mjs;
 * "buildertrend_schedule" by an earlier out-of-repo import). The schedule
 * link list hides them (isScheduleLinkType), exactly as before.
 */
export const STORED_SCHEDULE_LINK_TYPES = [...SCHEDULE_LINK_TYPES, "buildertrend", "buildertrend_schedule"] as const

/**
 * A schedule assignee's answer to the dates they were asked to commit to
 * (schedule_task_assignees.response_status). "pending" until they answer,
 * and again whenever staff change the dates. assignee-response-machine.ts
 * moves it. The same values hold the answer for the start date and for the
 * duration on their own (date_response_status, duration_response_status): a
 * proposal that only moves the date leaves the duration "pending".
 */
export const SCHEDULE_ASSIGNEE_RESPONSES = ["pending", "confirmed", "declined", "proposed"] as const
export type ScheduleAssigneeResponseStatus = (typeof SCHEDULE_ASSIGNEE_RESPONSES)[number]

/**
 * The single-assignee commitment on a schedule item
 * (schedule_tasks.confirmation_status): not asked, waiting on the assigned
 * account (or on someone getting one), or the answer. Moved only by
 * confirmation-machine.ts.
 */
export const SCHEDULE_CONFIRMATION_STATUSES = [
  "not_requested",
  "pending",
  "unavailable",
  "confirmed",
  "declined",
  "proposed",
] as const
export type ScheduleConfirmationStatus = (typeof SCHEDULE_CONFIRMATION_STATUSES)[number]
