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
  assignedUserId: z.string().nullable().default(null),
  // Participant IDs are server-side publication metadata used to prevent
  // unpublished child-assignee changes from appearing in external previews.
  assigneeParticipantIds: z.array(z.string()).default([]),
  ownerVisible: z.boolean().optional(),
  subVendorVisible: z.boolean().optional(),
  confirmationRequired: z.boolean().default(false),
  confirmationStatus: z
    .enum([
      "not_requested",
      "pending",
      "confirmed",
      "declined",
      "proposed",
      "unavailable",
    ])
    .default("not_requested"),
  confirmationRequestedAt: z.string().nullable().default(null),
  confirmationRespondedAt: z.string().nullable().default(null),
  reminderSentAt: z.string().nullable().default(null),
  proposedStartDate: z.string().nullable().default(null),
  proposedWorkdays: z.number().nullable().default(null),
  proposalNote: z.string().nullable().default(null),
  proposalSubmittedAt: z.string().nullable().default(null),
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

/** Compare what audiences can see, ignoring timestamps and live responses. */
export function hasScheduleDraftChanges(
  published: PublishedScheduleSnapshot,
  current: PublishedScheduleSnapshot
): boolean {
  const comparable = (snapshot: PublishedScheduleSnapshot): string =>
    JSON.stringify({
      tasks: snapshot.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        startDate: task.startDate,
        workdays: task.workdays,
        endDateCalculated: task.endDateCalculated,
        phase: task.phase,
        displayColor: task.displayColor,
        status: task.status,
        isCriticalPath: task.isCriticalPath,
        isMilestone: task.isMilestone,
        percentComplete: task.percentComplete,
        assignedTo: task.assignedTo,
        assignedUserId: task.assignedUserId,
        assigneeParticipantIds: [...task.assigneeParticipantIds].sort(),
        ownerVisible: task.ownerVisible,
        subVendorVisible: task.subVendorVisible,
        confirmationRequired: task.confirmationRequired,
        sortOrder: task.sortOrder,
      })).sort((left, right) => left.id.localeCompare(right.id)),
      dependencies: snapshot.dependencies.map((dependency) => ({
        id: dependency.id,
        predecessorId: dependency.predecessorId,
        successorId: dependency.successorId,
        type: dependency.type,
        lagDays: dependency.lagDays,
      })).sort((left, right) => left.id.localeCompare(right.id)),
      exceptions: snapshot.exceptions.map((exception) => ({
        id: exception.id,
        title: exception.title,
        startDate: exception.startDate,
        endDate: exception.endDate,
        type: exception.type,
        category: exception.category,
        recurrence: exception.recurrence,
        notes: exception.notes,
      })).sort((left, right) => left.id.localeCompare(right.id)),
    })

  return comparable(published) !== comparable(current)
}

export function activePublishedScheduleSnapshot(
  isPublished: boolean,
  snapshotData: string | null
): PublishedScheduleSnapshot | null {
  return isPublished && snapshotData !== null
    ? parsePublishedScheduleSnapshot(snapshotData)
    : null
}

export function getPublicationChangeReasonError(
  rawReason: string,
  hasPublishedSchedule: boolean
): string | null {
  const changeReason = rawReason.trim()
  if (changeReason.length > 500) {
    return "Enter a publish reason of 500 characters or less."
  }
  if (hasPublishedSchedule && changeReason.length < 3) {
    return "Enter a publish reason between 3 and 500 characters."
  }
  return null
}
