/**
 * Scoped reads of the schedule tables. Every read filters by project, or by a
 * project's own task ids chunked under D1's parameter limit, never by
 * reading a whole table and filtering it in JavaScript.
 */
import { and, asc, eq, inArray } from "drizzle-orm"

import {
  organizationMembers,
  projectAccessInvitations,
  projectContacts,
  projects,
  scheduleTasks,
  taskDependencies,
  users,
  workdayExceptions,
} from "@/db/schema"
import { scheduleTaskAssignees, scheduleTaskPeople } from "@/db/schema-participants"
import { chunkD1Values } from "@/lib/d1-query"
import type { ScheduleAssigneeInput } from "@/lib/schedule/assignees"
import type { Db } from "@/lib/server/action-context"
import type {
  ScheduleData,
  ScheduleTaskAssigneeData,
  ScheduleTaskPersonData,
  WorkdayExceptionData,
} from "@/lib/schedule/types"

import {
  dependenciesWithin,
  dependencyData,
  exceptionDataCast,
  nextSortOrder,
  taskWithProgress,
} from "./rules"

export type ScheduleTaskRow = typeof scheduleTasks.$inferSelect
export type TaskDependencyRow = typeof taskDependencies.$inferSelect
export type WorkdayExceptionRow = typeof workdayExceptions.$inferSelect

/** True when the project exists in the organization. */
export async function isOrganizationProject(
  db: Db,
  organizationId: string,
  projectId: string
): Promise<boolean> {
  const project = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
    .limit(1)
    .get()
  return project !== undefined
}

export async function findTask(db: Db, taskId: string): Promise<ScheduleTaskRow | undefined> {
  return db.select().from(scheduleTasks).where(eq(scheduleTasks.id, taskId)).limit(1).get()
}

/** A project's tasks in schedule (sort) order. */
export async function loadProjectTasks(db: Db, projectId: string): Promise<ScheduleTaskRow[]> {
  return db
    .select()
    .from(scheduleTasks)
    .where(eq(scheduleTasks.projectId, projectId))
    .orderBy(asc(scheduleTasks.sortOrder))
}

/** A project's tasks in storage order, for callers that never sorted them. */
export async function loadProjectTasksUnordered(db: Db, projectId: string): Promise<ScheduleTaskRow[]> {
  return db.select().from(scheduleTasks).where(eq(scheduleTasks.projectId, projectId))
}

export async function loadProjectTaskIds(db: Db, projectId: string): Promise<Set<string>> {
  const rows = await db
    .select({ id: scheduleTasks.id })
    .from(scheduleTasks)
    .where(eq(scheduleTasks.projectId, projectId))
  return new Set(rows.map((row) => row.id))
}

/** The selected tasks that belong to the project. */
export async function loadMatchingProjectTasks(
  db: Db,
  projectId: string,
  taskIds: readonly string[]
): Promise<{ readonly id: string; readonly confirmationRequired: boolean }[]> {
  return db
    .select({ id: scheduleTasks.id, confirmationRequired: scheduleTasks.confirmationRequired })
    .from(scheduleTasks)
    .where(and(eq(scheduleTasks.projectId, projectId), inArray(scheduleTasks.id, [...taskIds])))
}

/** The sort order for a new item appended to the project's schedule. */
export async function nextProjectSortOrder(db: Db, projectId: string): Promise<number> {
  const rows = await db
    .select({ sortOrder: scheduleTasks.sortOrder })
    .from(scheduleTasks)
    .where(eq(scheduleTasks.projectId, projectId))
    .orderBy(asc(scheduleTasks.sortOrder))
  return nextSortOrder(rows.map((row) => row.sortOrder))
}

/**
 * Dependencies between the given tasks. Reads by successor id in chunks, then
 * keeps the rows whose predecessor is also one of the tasks.
 */
export async function loadDependenciesForTasks(
  db: Db,
  taskIds: readonly string[]
): Promise<TaskDependencyRow[]> {
  if (taskIds.length === 0) return []
  const rows = (
    await Promise.all(
      chunkD1Values(taskIds).map((chunk) =>
        db.select().from(taskDependencies).where(inArray(taskDependencies.successorId, chunk))
      )
    )
  ).flat()
  return dependenciesWithin(new Set(taskIds), rows)
}

export async function findDependency(db: Db, dependencyId: string): Promise<TaskDependencyRow | undefined> {
  return db.select().from(taskDependencies).where(eq(taskDependencies.id, dependencyId)).limit(1).get()
}

/** Raw exception rows for a project. */
export async function loadProjectExceptionRows(db: Db, projectId: string): Promise<WorkdayExceptionRow[]> {
  return db.select().from(workdayExceptions).where(eq(workdayExceptions.projectId, projectId))
}

export async function loadProjectExceptions(db: Db, projectId: string): Promise<WorkdayExceptionData[]> {
  return (await loadProjectExceptionRows(db, projectId)).map(exceptionDataCast)
}

export async function findException(db: Db, exceptionId: string): Promise<WorkdayExceptionRow | undefined> {
  return db.select().from(workdayExceptions).where(eq(workdayExceptions.id, exceptionId)).limit(1).get()
}

/** Tasks, dependencies, and exceptions of one project (no assignees). */
export async function loadProjectScheduleRows(
  db: Db,
  projectId: string
): Promise<{ readonly tasks: ScheduleTaskRow[]; readonly dependencies: TaskDependencyRow[] }> {
  const tasks = await loadProjectTasksUnordered(db, projectId)
  const dependencies = await loadDependenciesForTasks(
    db,
    tasks.map((task) => task.id)
  )
  return { tasks, dependencies }
}

/** The working schedule staff edit: tasks with assignees, dependencies, exceptions. */
export async function loadWorkingSchedule(db: Db, projectId: string): Promise<ScheduleData> {
  const tasks = await loadProjectTasks(db, projectId)
  const taskIds = tasks.map((task) => task.id)
  // Chunked: one IN list over D1's 100-parameter limit used to fail and,
  // being fail-soft, showed every task unassigned on larger schedules.
  const assigneeRows = (
    await Promise.all(
      chunkD1Values(taskIds).map((chunk) =>
        db
          .select()
          .from(scheduleTaskAssignees)
          .where(inArray(scheduleTaskAssignees.scheduleTaskId, chunk))
          .catch(() => [])
      )
    )
  ).flat()
  const assigneesByTask = new Map<string, ScheduleTaskAssigneeData[]>()
  for (const row of assigneeRows) {
    const existing = assigneesByTask.get(row.scheduleTaskId) ?? []
    existing.push(row)
    assigneesByTask.set(row.scheduleTaskId, existing)
  }
  const peopleByTask = await loadTaskPeople(db, taskIds)
  const dependencies = await loadDependenciesForTasks(db, taskIds)
  const exceptions = await loadProjectExceptions(db, projectId)

  return {
    tasks: tasks.map((task) => ({
      ...taskWithProgress(task),
      assignees: assigneesByTask.get(task.id) ?? [],
      people: peopleByTask.get(task.id) ?? [],
    })),
    dependencies: dependencies.map(dependencyData),
    exceptions,
  }
}

/**
 * The account a schedule assignee option points to: an active organization
 * member ("team:<userId>") or the accepted invitation of a project contact
 * ("project:<projectContactId>").
 */
export async function resolveAssignedUserId(
  db: Db,
  organizationId: string,
  projectId: string,
  assigneeOptionId: string | null | undefined
): Promise<string | null> {
  if (!assigneeOptionId) return null

  if (assigneeOptionId.startsWith("team:")) {
    const userId = assigneeOptionId.slice("team:".length)
    const member = await db
      .select({ userId: users.id })
      .from(users)
      .innerJoin(organizationMembers, eq(organizationMembers.userId, users.id))
      .where(
        and(
          eq(users.id, userId),
          eq(users.isActive, true),
          eq(organizationMembers.organizationId, organizationId)
        )
      )
      .get()
    return member?.userId ?? null
  }

  if (assigneeOptionId.startsWith("project:")) {
    const projectContactId = assigneeOptionId.slice("project:".length)
    const invitation = await db
      .select({ userId: projectAccessInvitations.acceptedBy })
      .from(projectAccessInvitations)
      .where(
        and(
          eq(projectAccessInvitations.organizationId, organizationId),
          eq(projectAccessInvitations.projectId, projectId),
          eq(projectAccessInvitations.projectContactId, projectContactId),
          eq(projectAccessInvitations.status, "accepted")
        )
      )
      .get()
    return invitation?.userId ?? null
  }

  return null
}

/**
 * Everyone assigned to each task, in picked order, read by task id in chunks
 * under D1's parameter limit.
 */
export async function loadTaskPeople(
  db: Db,
  taskIds: readonly string[]
): Promise<Map<string, ScheduleTaskPersonData[]>> {
  const rows = (
    await Promise.all(
      chunkD1Values(taskIds).map((chunk) =>
        db
          .select({
            scheduleTaskId: scheduleTaskPeople.scheduleTaskId,
            position: scheduleTaskPeople.position,
            name: scheduleTaskPeople.displayName,
            assignedUserId: scheduleTaskPeople.assignedUserId,
            projectContactId: scheduleTaskPeople.projectContactId,
          })
          .from(scheduleTaskPeople)
          .where(inArray(scheduleTaskPeople.scheduleTaskId, chunk))
      )
    )
  ).flat()
  rows.sort((left, right) => left.position - right.position)
  const byTask = new Map<string, ScheduleTaskPersonData[]>()
  for (const { scheduleTaskId, name, assignedUserId, projectContactId } of rows) {
    const people = byTask.get(scheduleTaskId) ?? []
    people.push({ name, assignedUserId, projectContactId })
    byTask.set(scheduleTaskId, people)
  }
  return byTask
}

/**
 * The people rows for picked assignees: each picked option's Compass account
 * (see resolveAssignedUserId) and, for a project contact, the contact when it
 * belongs to this project. Typed names keep only their name.
 */
export async function resolveScheduleTaskPeople(
  db: Db,
  organizationId: string,
  projectId: string,
  inputs: readonly ScheduleAssigneeInput[]
): Promise<ScheduleTaskPersonData[]> {
  const contactIds = inputs.flatMap((input) =>
    input.optionId?.startsWith("project:") ? [input.optionId.slice("project:".length)] : []
  )
  const projectContactIds = new Set(
    (
      await Promise.all(
        chunkD1Values(contactIds).map((chunk) =>
          db
            .select({ id: projectContacts.id })
            .from(projectContacts)
            .where(and(eq(projectContacts.projectId, projectId), inArray(projectContacts.id, chunk)))
        )
      )
    )
      .flat()
      .map((row) => row.id)
  )
  return Promise.all(
    inputs.map(async (input) => {
      const contactId = input.optionId?.startsWith("project:")
        ? input.optionId.slice("project:".length)
        : null
      return {
        name: input.name,
        assignedUserId: await resolveAssignedUserId(db, organizationId, projectId, input.optionId),
        projectContactId: contactId !== null && projectContactIds.has(contactId) ? contactId : null,
      }
    })
  )
}
