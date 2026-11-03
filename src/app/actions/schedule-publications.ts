"use server"

import { and, asc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import {
  projects,
  scheduleTasks,
  workdayExceptions,
} from "@/db/schema"
import { scheduleTaskAssignees } from "@/db/schema-participants"
import { recordActivityEvent } from "@/lib/activity-log"
import {
  sendPublishedScheduleAssignment,
  sendScheduleTaskReminder,
} from "@/app/actions/schedule-confirmations"
import {
  canViewWorkingSchedule,
  scheduleReadContext,
  scheduleWriteContext,
} from "@/lib/domain/schedule/access"
import { updateProjectsReturningIds, updateProjectsStatement } from "@/lib/domain/project/store"
import { publishedAssigneeUserIds } from "@/lib/domain/schedule/assignment-notices"
import { loadDependenciesForTasks, loadTaskPeople } from "@/lib/domain/schedule/queries"
import { publicationInsertQuery } from "@/lib/domain/schedule/store"
import type { Db } from "@/lib/server/action-context"
import {
  getPublicationChangeReasonError,
  hasScheduleDraftChanges,
  parsePublishedScheduleSnapshot,
  publishedScheduleSnapshotSchema,
} from "@/lib/schedule/publications"
import { sameScheduleAssigneeSet } from "@/lib/schedule/multi-assignee"
import { addedAssigneeUserIds, scheduleItemAssigneeUserIds } from "@/lib/schedule/assignees"
import { latestSchedulePublication } from "@/lib/schedule/publication-history"

export type SchedulePublicationStatus = {
  readonly hasPublishedSchedule: boolean
  readonly hasUnpublishedChanges: boolean
  readonly publishedAt: string | null
  readonly publishedBy: string | null
  readonly changeReason: string | null
  /** True once people have published this schedule, even if it is now a draft. */
  readonly shiftReasonRequired: boolean
}

async function requireProject(
  db: Db,
  projectId: string,
  organizationId: string
): Promise<{ readonly id: string; readonly schedulePublished: boolean }> {
  const project = await db
    .select({ id: projects.id, schedulePublished: projects.schedulePublished })
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

function revalidateSchedulePublicationPaths(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}/schedule`)
  revalidatePath("/dashboard/schedule")
  revalidatePath(`/preview/projects/${projectId}/owner`)
  revalidatePath(`/preview/projects/${projectId}/owner/schedule`)
  revalidatePath(`/preview/projects/${projectId}/sub-vendor`)
  revalidatePath(`/preview/projects/${projectId}/sub-vendor/schedule`)
}

export async function getSchedulePublicationStatus(
  projectId: string
): Promise<SchedulePublicationStatus> {
  const { db, organizationId, user } = await scheduleReadContext()
  if (!canViewWorkingSchedule(user.role)) {
    throw new Error("Only internal project staff can view draft schedule status.")
  }
  const project = await requireProject(db, projectId, organizationId)

  const latest = await latestSchedulePublication(db, projectId)

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
      shiftReasonRequired: false,
    }
  }

  const tasks = await db
    .select()
    .from(scheduleTasks)
    .where(eq(scheduleTasks.projectId, projectId))
  const assigneeRows = await db
    .select({
      scheduleTaskId: scheduleTaskAssignees.scheduleTaskId,
      participantId: scheduleTaskAssignees.participantId,
    })
    .from(scheduleTaskAssignees)
    .innerJoin(scheduleTasks, eq(scheduleTasks.id, scheduleTaskAssignees.scheduleTaskId))
    .where(eq(scheduleTasks.projectId, projectId))
  const assigneeIdsByTask = new Map<string, string[]>()
  for (const row of assigneeRows) {
    const ids = assigneeIdsByTask.get(row.scheduleTaskId) ?? []
    ids.push(row.participantId)
    assigneeIdsByTask.set(row.scheduleTaskId, ids)
  }
  const dependencies = await loadDependenciesForTasks(
    db,
    tasks.map((task) => task.id)
  )
  const exceptions = await db
    .select()
    .from(workdayExceptions)
    .where(eq(workdayExceptions.projectId, projectId))
  const current = publishedScheduleSnapshotSchema.safeParse({
    version: 1,
    tasks: tasks.map((task) => ({
      ...task,
      assigneeParticipantIds: assigneeIdsByTask.get(task.id) ?? [],
    })),
    dependencies,
    exceptions,
  })
  const published = parsePublishedScheduleSnapshot(latest.snapshotData)

  return {
    hasPublishedSchedule: project.schedulePublished,
    hasUnpublishedChanges:
      !current.success || published === null ||
      hasScheduleDraftChanges(published, current.data),
    publishedAt: latest.publishedAt,
    publishedBy: latest.publishedBy,
    changeReason: latest.changeReason,
    shiftReasonRequired: true,
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
    const context = await scheduleWriteContext()
    if (!context.success) return context
    const { db, organizationId, user } = context.data
    if (!canViewWorkingSchedule(user.role)) {
      return { success: false, error: "Only internal project staff can publish a schedule." }
    }
    const changeReason = rawReason.trim()

    await requireProject(db, projectId, organizationId)

    const previousPublication = await latestSchedulePublication(db, projectId)
    const changeReasonError = getPublicationChangeReasonError(
      changeReason,
      previousPublication !== null
    )
    if (changeReasonError) {
      return { success: false, error: changeReasonError }
    }
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
    const [dependencies, peopleByTask] = await Promise.all([
      loadDependenciesForTasks(db, tasks.map((task) => task.id)),
      loadTaskPeople(db, tasks.map((task) => task.id)),
    ])
    const assigneeUserIdsByTask = new Map(
      tasks.map((task) => [
        task.id,
        scheduleItemAssigneeUserIds({ ...task, people: peopleByTask.get(task.id) ?? [] }),
      ])
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
        assigneeUserIds: assigneeUserIdsByTask.get(task.id) ?? [],
      })),
      dependencies,
      exceptions,
    })
    const publishedAt = new Date().toISOString()

    await db.batch([
      publicationInsertQuery(db, {
        id: crypto.randomUUID(),
        projectId,
        snapshotData: JSON.stringify(snapshot),
        changeReason: changeReason || "Initial publication.",
        publishedBy: user.id,
        publishedAt,
      }),
      updateProjectsStatement(
        db,
        and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)),
        { schedulePublished: true },
      ),
    ])
    await recordActivityEvent({
      db,
      organizationId,
      projectId,
      actor: user,
      category: "schedule",
      action: "schedule.published",
      entityType: "project_schedule",
      entityId: projectId,
      summary: changeReason
        ? `Published the project schedule: ${changeReason}`
        : "Published the project schedule.",
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
      // Each person added since the last publication is told once; people
      // already on the item are not told again.
      const addedUserIds = addedAssigneeUserIds(
        previousTask ? publishedAssigneeUserIds(previousTask) : [],
        assigneeUserIdsByTask.get(task.id) ?? []
      )
      if (
        addedUserIds.length > 0 &&
        !task.confirmationRequired &&
        (!previousPublication || previousSnapshot)
      ) {
        const notification = await sendPublishedScheduleAssignment(task.id, addedUserIds)
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

    revalidateSchedulePublicationPaths(projectId)
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

export async function moveScheduleToDraft(
  projectId: string
): Promise<{ readonly success: true } | { readonly success: false; readonly error: string }> {
  try {
    const context = await scheduleWriteContext()
    if (!context.success) return context
    const { db, organizationId, user } = context.data
    if (!canViewWorkingSchedule(user.role)) {
      return { success: false, error: "Only internal project staff can change schedule visibility." }
    }
    await requireProject(db, projectId, organizationId)

    const changed = await updateProjectsReturningIds(
      db,
      and(
        eq(projects.id, projectId),
        eq(projects.organizationId, organizationId),
        eq(projects.schedulePublished, true)
      ),
      { schedulePublished: false },
    )
    if (changed.length === 0) {
      return { success: false, error: "This schedule is already a draft." }
    }

    await recordActivityEvent({
      db,
      organizationId,
      projectId,
      actor: user,
      category: "schedule",
      action: "schedule.unpublished",
      entityType: "project_schedule",
      entityId: projectId,
      summary: "Moved the project schedule to draft and hid it from owners and subcontractors.",
    })
    revalidateSchedulePublicationPaths(projectId)
    return { success: true }
  } catch (error) {
    console.error("Unable to move schedule to draft", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to move the schedule to draft.",
    }
  }
}
