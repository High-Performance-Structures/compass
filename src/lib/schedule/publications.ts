import { z } from "zod/v4"

const publishedTaskSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  startDate: z.string(),
  workdays: z.number(),
  endDateCalculated: z.string(),
  phase: z.string(),
  displayColor: z.string().nullable(),
  status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETE", "BLOCKED"]),
  isCriticalPath: z.boolean(),
  isMilestone: z.boolean(),
  percentComplete: z.number(),
  assignedTo: z.string().nullable(),
  sortOrder: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const publishedDependencySchema = z.object({
  id: z.string(),
  predecessorId: z.string(),
  successorId: z.string(),
  type: z.enum(["FS", "SS", "FF", "SF"]),
  lagDays: z.number(),
})

const publishedExceptionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  type: z.enum(["non_working", "working"]),
  category: z.enum([
    "national_holiday",
    "state_holiday",
    "vacation_day",
    "company_holiday",
    "weather_day",
    "extra_workday",
  ]),
  recurrence: z.enum(["one_time", "yearly"]),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const publishedScheduleSnapshotSchema = z.object({
  version: z.literal(1),
  tasks: z.array(publishedTaskSchema),
  dependencies: z.array(publishedDependencySchema),
  exceptions: z.array(publishedExceptionSchema),
})

export type PublishedScheduleSnapshot = z.infer<
  typeof publishedScheduleSnapshotSchema
>

export function parsePublishedScheduleSnapshot(
  value: string
): PublishedScheduleSnapshot | null {
  try {
    const result = publishedScheduleSnapshotSchema.safeParse(JSON.parse(value))
    return result.success ? result.data : null
  } catch {
    return null
  }
}

export const DRAFT_SCHEDULE_ACTIONS = [
  "schedule.item_created",
  "schedule.item_updated",
  "schedule.item_deleted",
  "schedule.items_completed",
  "schedule.items_assigned",
  "schedule.items_deleted",
  "schedule.items_reordered",
  "schedule.item_status_changed",
  "schedule.dependency_created",
  "schedule.dependency_updated",
  "schedule.dependency_deleted",
  "schedule.workday_exception_created",
  "schedule.workday_exception_updated",
  "schedule.workday_exception_deleted",
] as const

export function isDraftScheduleAction(action: string): boolean {
  return DRAFT_SCHEDULE_ACTIONS.some((draftAction) => draftAction === action)
}
