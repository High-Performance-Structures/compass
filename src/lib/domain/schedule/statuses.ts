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
