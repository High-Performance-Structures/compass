/**
 * The only code that inserts, updates, or deletes the schedule tables:
 * schedule_tasks, task_dependencies, schedule_task_assignees,
 * schedule_baselines, schedule_task_links, schedule_publications, and
 * workday_exceptions (architecture standard, section 1). Saved schedule views
 * belong to domain/settings/store.ts with every other saved view. No auth here: callers resolve the action context first.
 *
 * Functions named `...Statement` or `...Query` return an unexecuted
 * statement so a caller can put it in one atomic batch with another
 * module's write (for example a linked to-do or the project row).
 */
import { and, eq, inArray } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"

import {
  scheduleBaselines,
  schedulePublications,
  scheduleTaskLinks,
  scheduleTasks,
  taskDependencies,
} from "@/db/schema"
import { scheduleTaskAssignees } from "@/db/schema-participants"
import { linkedTodoDateUpdateStatement } from "@/lib/domain/operations/store"
import type { Db } from "@/lib/server/action-context"
import type { ScheduleTaskData, TaskDependencyData, WorkdayExceptionData } from "@/lib/schedule/types"

import { loadProjectScheduleRows } from "./queries"
import { criticalPathChanges, dependencyData, taskWithStatus, type DateUpdates } from "./rules"

type TaskInsert = typeof scheduleTasks.$inferInsert
type TaskUpdate = Partial<TaskInsert>

/*
 * D1 caps the statements in one batch. These groups bound the number of
 * schedule items per batch (each item needs two or three statements); it is
 * a statement limit, not the bound-parameter limit chunkD1Values covers.
 */
const ITEMS_PER_BATCH = 40

function itemGroups<T>(values: readonly T[]): T[][] {
  const groups: T[][] = []
  for (let index = 0; index < values.length; index += ITEMS_PER_BATCH) {
    groups.push(values.slice(index, index + ITEMS_PER_BATCH))
  }
  return groups
}

async function runD1Batch(
  database: D1Database,
  statements: D1PreparedStatement[],
  failureMessage: string
): Promise<void> {
  const results = await database.batch(statements)
  if (results.some((result) => !result.success)) throw new Error(failureMessage)
}

// ---------------------------------------------------------------------------
// Schedule tasks
// ---------------------------------------------------------------------------

export function taskInsertQuery(db: Db, row: TaskInsert): BatchItem<"sqlite"> {
  return db.insert(scheduleTasks).values(row)
}

export async function insertTask(db: Db, row: TaskInsert): Promise<void> {
  await db.insert(scheduleTasks).values(row)
}

export function taskUpdateQuery(db: Db, taskId: string, values: TaskUpdate): BatchItem<"sqlite"> {
  return db.update(scheduleTasks).set(values).where(eq(scheduleTasks.id, taskId))
}

export async function updateTask(db: Db, taskId: string, values: TaskUpdate): Promise<void> {
  await db.update(scheduleTasks).set(values).where(eq(scheduleTasks.id, taskId))
}

/** Updates a task only while it is still assigned to `assignedUserId`. */
export async function updateTaskForAssignee(
  db: Db,
  taskId: string,
  assignedUserId: string,
  values: TaskUpdate
): Promise<void> {
  await db
    .update(scheduleTasks)
    .set(values)
    .where(and(eq(scheduleTasks.id, taskId), eq(scheduleTasks.assignedUserId, assignedUserId)))
}

export async function markTaskReminderSent(
  db: Db,
  taskId: string,
  projectId: string,
  now: string
): Promise<void> {
  await db
    .update(scheduleTasks)
    .set({ reminderSentAt: now, updatedAt: now })
    .where(and(eq(scheduleTasks.id, taskId), eq(scheduleTasks.projectId, projectId)))
}

export async function deleteTask(db: Db, taskId: string): Promise<void> {
  await db.delete(scheduleTasks).where(eq(scheduleTasks.id, taskId))
}

export async function deleteProjectTasks(db: Db, projectId: string, taskIds: readonly string[]): Promise<void> {
  await db
    .delete(scheduleTasks)
    .where(and(eq(scheduleTasks.projectId, projectId), inArray(scheduleTasks.id, [...taskIds])))
}

export async function completeProjectTasks(
  db: Db,
  projectId: string,
  taskIds: readonly string[],
  now: string
): Promise<void> {
  await db
    .update(scheduleTasks)
    .set({ status: "COMPLETE", percentComplete: 100, updatedAt: now })
    .where(and(eq(scheduleTasks.projectId, projectId), inArray(scheduleTasks.id, [...taskIds])))
}

/**
 * Sets the legacy scalar assignee on each task and removes its normalized
 * assignees in the same batch, since those rows carry their own response
 * authority.
 */
export async function assignProjectTasks(
  db: Db,
  projectId: string,
  tasks: readonly { readonly id: string; readonly confirmationRequired: boolean }[],
  assignedTo: string | null,
  now: string
): Promise<void> {
  for (const group of itemGroups(tasks)) {
    const [first, ...rest] = group.flatMap((task): BatchItem<"sqlite">[] => [
      db.delete(scheduleTaskAssignees).where(eq(scheduleTaskAssignees.scheduleTaskId, task.id)),
      db
        .update(scheduleTasks)
        .set({
          assignedTo,
          assignedUserId: null,
          confirmationStatus: task.confirmationRequired ? "unavailable" : "not_requested",
          confirmationRequestedAt: task.confirmationRequired ? now : null,
          confirmationRespondedAt: null,
          reminderSentAt: null,
          updatedAt: now,
        })
        .where(and(eq(scheduleTasks.id, task.id), eq(scheduleTasks.projectId, projectId))),
    ])
    if (!first) continue
    await db.batch([first, ...rest])
  }
}

/** Moves tasks to new dates by id (no linked to-do or assignee changes). */
export async function updateTaskDates(db: Db, updates: DateUpdates, now: string): Promise<void> {
  for (const group of itemGroups([...updates])) {
    const [first, ...rest] = group.map(
      ([taskId, dates]): BatchItem<"sqlite"> =>
        db
          .update(scheduleTasks)
          .set({ startDate: dates.startDate, endDateCalculated: dates.endDateCalculated, updatedAt: now })
          .where(eq(scheduleTasks.id, taskId))
    )
    if (!first) continue
    await db.batch([first, ...rest])
  }
}

/** The linked to-do shift and the task date change for each moved task. */
function dateUpdateStatements(
  database: D1Database,
  projectId: string,
  updates: DateUpdates,
  updatedAt: string
): D1PreparedStatement[] {
  return [...updates].flatMap(([taskId, dates]) => [
    // The to-do statement runs first so its offsets use the previous dates.
    linkedTodoDateUpdateStatement(database, {
      scheduleTaskId: taskId,
      nextStartDate: dates.startDate,
      nextEndDate: dates.endDateCalculated,
      updatedAt,
    }),
    database
      .prepare(
        `UPDATE schedule_tasks
         SET start_date = ?, end_date_calculated = ?, updated_at = ?
         WHERE id = ? AND project_id = ?`
      )
      .bind(dates.startDate, dates.endDateCalculated, updatedAt, taskId, projectId),
  ])
}

/**
 * Runs `leading` (a dependency or workday-exception change) and the date
 * moves it causes, with their linked to-dos, in one atomic batch.
 */
export async function runWithDateUpdates(
  database: D1Database,
  leading: D1PreparedStatement,
  projectId: string,
  updates: DateUpdates,
  updatedAt: string,
  failureMessage: string
): Promise<void> {
  await runD1Batch(
    database,
    [leading, ...dateUpdateStatements(database, projectId, updates, updatedAt)],
    failureMessage
  )
}

/**
 * Persists propagated dates. Each moved task also shifts its linked to-dos
 * and resets its assignees' responses, which were given against the old
 * dates.
 */
export async function persistScheduleDateUpdates(
  database: D1Database,
  projectId: string,
  updates: DateUpdates,
  updatedAt: string
): Promise<void> {
  for (const group of itemGroups([...updates])) {
    const statements = group.flatMap(([taskId, dates]) => [
      ...dateUpdateStatements(database, projectId, new Map([[taskId, dates]]), updatedAt),
      database
        .prepare(
          `UPDATE schedule_task_assignees
           SET source_start_date = ?,
               source_end_date = ?,
               response_status = 'pending',
               date_response_status = 'pending',
               duration_response_status = 'pending',
               proposed_start_date = NULL,
               proposed_workdays = NULL,
               proposed_end_date = NULL,
               response_message = NULL,
               responded_at = NULL,
               responded_by_user_id = NULL,
               response_source = NULL,
               assigned_at = ?,
               updated_at = ?
           WHERE schedule_task_id = ?`
        )
        .bind(dates.startDate, dates.endDateCalculated, updatedAt, updatedAt, taskId),
    ])
    await runD1Batch(database, statements, "Schedule date update batch failed")
  }
}

/** Recomputes the critical path and stores the flags that changed. */
export async function recalcCriticalPath(db: Db, projectId: string): Promise<void> {
  const { tasks, dependencies } = await loadProjectScheduleRows(db, projectId)
  const changes = criticalPathChanges(tasks.map(taskWithStatus), dependencies.map(dependencyData))
  for (const group of itemGroups(changes)) {
    const [first, ...rest] = group.map(
      (change): BatchItem<"sqlite"> =>
        db
          .update(scheduleTasks)
          .set({ isCriticalPath: change.isCriticalPath })
          .where(eq(scheduleTasks.id, change.id))
    )
    if (!first) continue
    await db.batch([first, ...rest])
  }
}

/** A task created from a schedule template, for a template application batch. */
export function templateTaskInsertStatement(
  database: D1Database,
  projectId: string,
  task: Pick<
    ScheduleTaskData,
    "id" | "title" | "startDate" | "workdays" | "endDateCalculated" | "phase" | "isMilestone" | "assignedTo" | "sortOrder"
  > & {
    readonly displayColor: string | null
    readonly ownerVisible: boolean
    readonly subVendorVisible: boolean
  },
  now: string,
  notes: string | null
): D1PreparedStatement {
  return database
    .prepare(
      `INSERT INTO schedule_tasks (
        id, project_id, title, start_date, workdays,
        end_date_calculated, phase, display_color, status,
        is_critical_path, is_milestone, percent_complete, assigned_to,
        assigned_user_id, owner_visible, sub_vendor_visible,
        confirmation_required, confirmation_status, sort_order,
        created_at, updated_at, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, ?, 0, ?, NULL,
        ?, ?, 0, 'not_requested', ?, ?, ?, ?)`
    )
    .bind(
      task.id,
      projectId,
      task.title,
      task.startDate,
      task.workdays,
      task.endDateCalculated,
      task.phase,
      task.displayColor,
      task.isMilestone ? 1 : 0,
      task.assignedTo,
      task.ownerVisible ? 1 : 0,
      task.subVendorVisible ? 1 : 0,
      task.sortOrder,
      now,
      now,
      notes
    )
}

// ---------------------------------------------------------------------------
// Task assignees
// ---------------------------------------------------------------------------

export function clearTaskAssigneesQuery(db: Db, taskId: string): BatchItem<"sqlite"> {
  return db.delete(scheduleTaskAssignees).where(eq(scheduleTaskAssignees.scheduleTaskId, taskId))
}

/** Re-asks every assignee of a task once its dates or terms change. */
export function resetTaskAssigneesQuery(
  db: Db,
  taskId: string,
  source: { readonly startDate: string; readonly workdays: number; readonly endDate: string },
  now: string
): BatchItem<"sqlite"> {
  return db
    .update(scheduleTaskAssignees)
    .set({
      sourceStartDate: source.startDate,
      sourceWorkdays: source.workdays,
      sourceEndDate: source.endDate,
      responseStatus: "pending",
      dateResponseStatus: "pending",
      durationResponseStatus: "pending",
      proposedStartDate: null,
      proposedWorkdays: null,
      proposedEndDate: null,
      responseMessage: null,
      respondedAt: null,
      respondedByUserId: null,
      responseSource: null,
      assignedAt: now,
      updatedAt: now,
    })
    .where(eq(scheduleTaskAssignees.scheduleTaskId, taskId))
}

export async function recordAssigneeResponse(
  db: Db,
  assignmentId: string,
  values: Partial<typeof scheduleTaskAssignees.$inferInsert>
): Promise<void> {
  await db.update(scheduleTaskAssignees).set(values).where(eq(scheduleTaskAssignees.id, assignmentId))
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export async function insertDependency(db: Db, dependency: TaskDependencyData): Promise<void> {
  await db.insert(taskDependencies).values({
    id: dependency.id,
    predecessorId: dependency.predecessorId,
    successorId: dependency.successorId,
    type: dependency.type,
    lagDays: dependency.lagDays,
  })
}

export async function deleteDependency(db: Db, dependencyId: string): Promise<void> {
  await db.delete(taskDependencies).where(eq(taskDependencies.id, dependencyId))
}

export function dependencyInsertStatement(
  database: D1Database,
  dependency: TaskDependencyData
): D1PreparedStatement {
  return database
    .prepare(
      `INSERT INTO task_dependencies (
        id, predecessor_id, successor_id, type, lag_days
      ) VALUES (?, ?, ?, ?, ?)`
    )
    .bind(dependency.id, dependency.predecessorId, dependency.successorId, dependency.type, dependency.lagDays)
}

export function dependencyUpdateStatement(
  database: D1Database,
  dependency: TaskDependencyData
): D1PreparedStatement {
  return database
    .prepare(
      `UPDATE task_dependencies
       SET predecessor_id = ?, successor_id = ?, type = ?, lag_days = ?
       WHERE id = ?`
    )
    .bind(dependency.predecessorId, dependency.successorId, dependency.type, dependency.lagDays, dependency.id)
}

// ---------------------------------------------------------------------------
// Workday exceptions
// ---------------------------------------------------------------------------

export function exceptionInsertStatement(
  database: D1Database,
  exception: WorkdayExceptionData
): D1PreparedStatement {
  return database
    .prepare(
      `INSERT INTO workday_exceptions (
         id, project_id, title, start_date, end_date, type, category,
         recurrence, notes, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      exception.id,
      exception.projectId,
      exception.title,
      exception.startDate,
      exception.endDate,
      exception.type,
      exception.category,
      exception.recurrence,
      exception.notes,
      exception.createdAt,
      exception.updatedAt
    )
}

export function exceptionUpdateStatement(
  database: D1Database,
  exception: WorkdayExceptionData
): D1PreparedStatement {
  return database
    .prepare(
      `UPDATE workday_exceptions
       SET title = ?, start_date = ?, end_date = ?, type = ?, category = ?,
           recurrence = ?, notes = ?, updated_at = ?
       WHERE id = ? AND project_id = ?`
    )
    .bind(
      exception.title,
      exception.startDate,
      exception.endDate,
      exception.type,
      exception.category,
      exception.recurrence,
      exception.notes,
      exception.updatedAt,
      exception.id,
      exception.projectId
    )
}

export function exceptionDeleteStatement(
  database: D1Database,
  exceptionId: string,
  projectId: string
): D1PreparedStatement {
  return database
    .prepare("DELETE FROM workday_exceptions WHERE id = ? AND project_id = ?")
    .bind(exceptionId, projectId)
}

// ---------------------------------------------------------------------------
// Baselines, links, saved views, publications
// ---------------------------------------------------------------------------

export async function insertBaseline(db: Db, row: typeof scheduleBaselines.$inferInsert): Promise<void> {
  await db.insert(scheduleBaselines).values(row)
}

export async function deleteBaseline(db: Db, baselineId: string): Promise<void> {
  await db.delete(scheduleBaselines).where(eq(scheduleBaselines.id, baselineId))
}

export async function insertTaskLink(db: Db, row: typeof scheduleTaskLinks.$inferInsert): Promise<void> {
  await db.insert(scheduleTaskLinks).values(row)
}

export async function deleteTaskLink(db: Db, linkId: string, projectId: string): Promise<void> {
  await db
    .delete(scheduleTaskLinks)
    .where(and(eq(scheduleTaskLinks.id, linkId), eq(scheduleTaskLinks.projectId, projectId)))
}

export function publicationInsertQuery(
  db: Db,
  row: typeof schedulePublications.$inferInsert
): BatchItem<"sqlite"> {
  return db.insert(schedulePublications).values(row)
}
