"use server"

import { and, asc, desc, eq, gt, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  activityEvents,
  projects,
  schedulePublications,
  scheduleTasks,
  taskDependencies,
  workdayExceptions,
} from "@/db/schema"
import { scheduleTaskAssignees } from "@/db/schema-participants"
import { recordActivityEvent } from "@/lib/activity-log"
import {
  sendPublishedScheduleAssignment,
  sendScheduleTaskReminder,
} from "@/app/actions/schedule-confirmations"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { requireOrg } from "@/lib/org-scope"
import { requirePermission } from "@/lib/permissions"
import {
  DRAFT_SCHEDULE_ACTIONS,
  parsePublishedScheduleSnapshot,
  publishedScheduleSnapshotSchema,
} from "@/lib/schedule/publications"
import { sameScheduleAssigneeSet } from "@/lib/schedule/multi-assignee"

export type SchedulePublicationStatus = {
  readonly hasPublishedSchedule: boolean
  readonly hasUnpublishedChanges: boolean
  readonly publishedAt: string | null
  readonly publishedBy: string | null
  readonly changeReason: string | null
}

async function requireProject(
  db: ReturnType<typeof getDb>,
  projectId: string,
  organizationId: string
): Promise<{ readonly id: string }> {
  const project = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organizationId, organizationId)
      )
    )
    .get()

  if (!project) throw new Error("Project not found or access denied")
  return project
}

export async function getSchedulePublicationStatus(
  projectId: string
): Promise<SchedulePublicationStatus> {
  const user = await requireAuth()
  requirePermission(user, "schedule", "read")
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  await requireProject(db, projectId, organizationId)

  const latest = await db
    .select({
      publishedAt: schedulePublications.publishedAt,
      publishedBy: schedulePublications.publishedBy,
      changeReason: schedulePublications.changeReason,
    })
    .from(schedulePublications)
    .where(eq(schedulePublications.projectId, projectId))
    .orderBy(desc(schedulePublications.publishedAt))
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (!latest) {
    const firstTask = await db
      .select({ id: scheduleTasks.id })
      .from(scheduleTasks)
      .where(eq(scheduleTasks.projectId, projectId))
      .limit(1)
      .then((rows) => rows[0] ?? null)
    return {
      hasPublishedSchedule: false,
      hasUnpublishedChanges: firstTask !== null,
      publishedAt: null,
      publishedBy: null,
      changeReason: null,
    }
  }

  const laterDraftEvent = await db
    .select({ id: activityEvents.id })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.organizationId, organizationId),
        eq(activityEvents.projectId, projectId),
        eq(activityEvents.category, "schedule"),
        gt(activityEvents.createdAt, latest.publishedAt),
        inArray(activityEvents.action, DRAFT_SCHEDULE_ACTIONS)
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)

  return {
    hasPublishedSchedule: true,
    hasUnpublishedChanges: laterDraftEvent !== null,
    publishedAt: latest.publishedAt,
    publishedBy: latest.publishedBy,
    changeReason: latest.changeReason,
  }
}

export async function publishSchedule(
  projectId: string,
  rawReason: string
): Promise<
  | { readonly success: true; readonly publishedAt: string }
  | { readonly success: false; readonly error: string }
> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "schedule", "update")
    const organizationId = requireOrg(user)
    const changeReason = rawReason.trim()
    if (changeReason.length < 3 || changeReason.length > 500) {
      return {
        success: false,
        error: "Enter a publish reason between 3 and 500 characters.",
      }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    await requireProject(db, projectId, organizationId)

    const previousPublication = await db
      .select({ snapshotData: schedulePublications.snapshotData })
      .from(schedulePublications)
      .where(eq(schedulePublications.projectId, projectId))
      .orderBy(desc(schedulePublications.publishedAt))
      .limit(1)
      .then((rows) => rows[0] ?? null)
    const previousSnapshot = previousPublication
      ? parsePublishedScheduleSnapshot(previousPublication.snapshotData)
      : null
    const previousTasksById = new Map(
      previousSnapshot?.tasks.map((task) => [task.id, task]) ?? []
    )
    const tasks = await db
      .select()
      .from(scheduleTasks)
      .where(eq(scheduleTasks.projectId, projectId))
      .orderBy(asc(scheduleTasks.sortOrder))
    const assigneeRows = await db
      .select({
        scheduleTaskId: scheduleTaskAssignees.scheduleTaskId,
        participantId: scheduleTaskAssignees.participantId,
      })
      .from(scheduleTaskAssignees)
      .innerJoin(
        scheduleTasks,
        eq(scheduleTasks.id, scheduleTaskAssignees.scheduleTaskId)
      )
      .where(eq(scheduleTasks.projectId, projectId))
    const assigneeIdsByTask = new Map<string, string[]>()
    for (const row of assigneeRows) {
      const ids = assigneeIdsByTask.get(row.scheduleTaskId) ?? []
      ids.push(row.participantId)
      assigneeIdsByTask.set(row.scheduleTaskId, ids)
    }
    const taskIds = new Set(tasks.map((task) => task.id))
    const dependencies = (await db.select().from(taskDependencies)).filter(
      (dependency) =>
        taskIds.has(dependency.predecessorId) &&
        taskIds.has(dependency.successorId)
    )
    const exceptions = await db
      .select()
      .from(workdayExceptions)
      .where(eq(workdayExceptions.projectId, projectId))
      .orderBy(asc(workdayExceptions.startDate))
    const snapshot = publishedScheduleSnapshotSchema.parse({
      version: 1,
      tasks: tasks.map((task) => ({
        ...task,
        assigneeParticipantIds: assigneeIdsByTask.get(task.id) ?? [],
      })),
      dependencies,
      exceptions,
    })
    const publishedAt = new Date().toISOString()

    await db.insert(schedulePublications).values({
      id: crypto.randomUUID(),
      projectId,
      snapshotData: JSON.stringify(snapshot),
      changeReason,
      publishedBy: user.id,
      publishedAt,
    })
    await recordActivityEvent({
      db,
      organizationId,
      projectId,
      actor: user,
      category: "schedule",
      action: "schedule.published",
      entityType: "project_schedule",
      entityId: projectId,
      summary: `Published the project schedule: ${changeReason}`,
      metadata: {
        itemCount: tasks.length,
        dependencyCount: dependencies.length,
        exceptionCount: exceptions.length,
      },
      createdAt: publishedAt,
    })
    for (const task of tasks) {
      const previousTask = previousTasksById.get(task.id)
      const assigneeParticipantIds = assigneeIdsByTask.get(task.id) ?? []
      if (assigneeParticipantIds.length > 0) {
        const normalizedAssignmentChanged =
          !previousTask ||
          !sameScheduleAssigneeSet(
            previousTask.assigneeParticipantIds,
            assigneeParticipantIds,
          ) ||
          previousTask.startDate !== task.startDate ||
          previousTask.workdays !== task.workdays ||
          previousTask.confirmationRequired !== task.confirmationRequired
        if (
          normalizedAssignmentChanged &&
          (!previousPublication || previousSnapshot)
        ) {
          const notification = await sendPublishedScheduleAssignment(task.id)
          if (!notification.success) {
            console.error(
              `Unable to notify published schedule assignees for ${task.id}:`,
              notification.error,
            )
          }
        }
        continue
      }
      const assignmentChanged =
        task.assignedTo !== null &&
        (previousTask?.assignedTo !== task.assignedTo ||
          previousTask.assignedUserId !== task.assignedUserId)
      if (
        assignmentChanged &&
        task.assignedUserId &&
        !task.confirmationRequired &&
        (!previousPublication || previousSnapshot)
      ) {
        const notification = await sendPublishedScheduleAssignment(task.id)
        if (!notification.success) {
          console.error(
            `Unable to send published schedule assignment for ${task.id}:`,
            notification.error
          )
        }
      }
      if (
        task.confirmationRequired &&
        task.assignedUserId &&
        task.confirmationStatus === "pending" &&
        !task.reminderSentAt
      ) {
        const reminder = await sendScheduleTaskReminder(task.id)
        if (!reminder.success) {
          console.error(
            `Unable to send published schedule confirmation for ${task.id}:`,
            reminder.error
          )
        }
      }
    }

    revalidatePath(`/dashboard/projects/${projectId}/schedule`)
    revalidatePath("/dashboard/schedule")
    revalidatePath(`/preview/projects/${projectId}/owner`)
    revalidatePath(`/preview/projects/${projectId}/owner/schedule`)
    revalidatePath(`/preview/projects/${projectId}/sub-vendor`)
    revalidatePath(`/preview/projects/${projectId}/sub-vendor/schedule`)
    return { success: true, publishedAt }
  } catch (error) {
    console.error("Unable to publish schedule", error)
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to publish the schedule.",
    }
  }
}
