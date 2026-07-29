import { z } from "zod/v4"

export const SCHEDULE_VIEW_PRESETS = [
  "all",
  "my-items",
  "past-due",
  "next-7",
  "next-30",
  "next-90",
] as const

export const SCHEDULE_GROUP_MODES = [
  "none",
  "phase",
  "project",
  "status",
] as const

export const SCHEDULE_LIST_COLUMNS = [
  "project",
  "complete",
  "phase",
  "duration",
  "startDate",
  "endDateCalculated",
  "assignedTo",
] as const

export type ScheduleViewPreset = (typeof SCHEDULE_VIEW_PRESETS)[number]
export type ScheduleGroupMode = (typeof SCHEDULE_GROUP_MODES)[number]
export type ScheduleListColumn = (typeof SCHEDULE_LIST_COLUMNS)[number]

const taskStatusSchema = z.enum([
  "PENDING",
  "IN_PROGRESS",
  "COMPLETE",
  "BLOCKED",
])

export const scheduleViewDefinitionSchema = z.object({
  view: z.enum(["calendar", "list", "gantt"]),
  orderMode: z.enum(["chronological", "manual"]),
  groupMode: z.enum(SCHEDULE_GROUP_MODES),
  preset: z.enum(SCHEDULE_VIEW_PRESETS),
  status: z.array(taskStatusSchema).max(4),
  phase: z.array(z.string().trim().min(1).max(100)).max(50),
  assignedTo: z.string().max(200),
  search: z.string().max(200),
  columns: z.array(z.enum(SCHEDULE_LIST_COLUMNS)).max(
    SCHEDULE_LIST_COLUMNS.length
  ),
})

export type ScheduleViewDefinition = z.infer<
  typeof scheduleViewDefinitionSchema
>

export type SavedScheduleViewData = {
  readonly id: string
  readonly name: string
  readonly visibility: "personal" | "shared"
  readonly ownerUserId: string
  readonly isOwner: boolean
  readonly definition: ScheduleViewDefinition
}

export function scheduleAssigneeTerms(user: {
  readonly email: string
  readonly displayName: string | null
  readonly firstName: string | null
  readonly lastName: string | null
} | null): readonly string[] {
  if (!user) return []
  const fullName = [user.firstName, user.lastName]
    .filter((value) => Boolean(value?.trim()))
    .join(" ")
    .trim()
  const terms = [user.displayName, fullName, user.email].flatMap((value) =>
    value ? [value] : []
  )
  return [...new Set(terms)]
}
