/**
 * The only code that inserts, updates, or deletes the schedule tables:
 * schedule_tasks, task_dependencies, schedule_task_assignees,
 * schedule_task_people,
 * schedule_baselines, schedule_task_links, schedule_publications, and
 * workday_exceptions (architecture standard, section 1). Saved schedule views
 * belong to domain/settings/store.ts with every other saved view. No auth here: callers resolve the action context first.
 *
 * Functions named `...Statement` or `...Query` return an unexecuted
 * statement so a caller can put it in one atomic batch with another
 * module's write (for example a linked to-do or the project row).
 */
import { and, eq, exists, inArray, isNull, type SQL } from "drizzle-orm"
import type { SQLiteColumn } from "drizzle-orm/sqlite-core"
import type { BatchItem } from "drizzle-orm/batch"

import {
  scheduleBaselines,
  schedulePublications,
  scheduleTaskLinks,
  scheduleTasks,
  taskDependencies,
} from "@/db/schema"
import { scheduleTaskAssignees, scheduleTaskPeople } from "@/db/schema-participants"
import { chunkD1InsertRows } from "@/lib/d1-query"
import { linkedTodoDateUpdateStatement } from "@/lib/domain/operations/store"
import type { Db } from "@/lib/server/action-context"
import type {
  ScheduleTaskData,
  ScheduleTaskPersonData,
  TaskDependencyData,
  WorkdayExceptionData,
} from "@/lib/schedule/types"
import { namedAssignee } from "@/lib/schedule/assignees"

import { confirmationMachine, confirmationStatusAfter, type ConfirmationAnswerEvent } from "./confirmation-machine"
import { assigneeResponseMachine, assigneeResponseParts, type AssigneeAnswerEvent } from "./assignee-response-machine"
import { loadProjectScheduleRows } from "./queries"
import { criticalPathChanges, dependencyData, taskWithStatus } from "./rules"
import { dateMovesLimitError, type DateMove, type DateMoveRules, type DateMoves } from "./date-moves"
import type { ScheduleAssigneeResponseStatus } from "./statuses"

type TaskInsert = typeof scheduleTasks.$inferInsert

/** Assignee answers once staff move an item or re-ask (the machine's reset). */
const RESET = assigneeResponseParts("reset")
/** Dates are written only by the date moves (below). */
type TaskUpdate = Omit<Partial<TaskInsert>, "startDate" | "workdays" | "endDateCalculated">

/*
 * D1 caps the statements in one batch. These groups bound the number of
 * schedule items per batch (each item needs up to three statements); it is
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

async function runD1Batch(database: D1Database, statements: D1PreparedStatement[], failureMessage: string): Promise<void> {
  if (statements.length === 0) return
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

// Single-assignee confirmations (confirmation-machine.ts). Staff events are
// written with the item's other edits; these two are compare-and-set.

/** The item as the assignee answered it, read before they answered. */
export type ConfirmationVersion = {
  readonly id: string
  readonly assignedUserId: string
  readonly startDate: string
  readonly workdays: number
  readonly confirmationRequestedAt: string | null
  readonly confirmationRespondedAt: string | null
}

/**
 * Records the assigned account's answer. It lands only while the item still
 * asks them for one, at the dates and request in `seen`, with no answer since.
 * Otherwise "already_recorded" when the same answer landed first (a double
 * submit), and "schedule_changed" when staff moved, re-asked or reassigned.
 */
export async function recordConfirmationAnswer(
  db: Db,
  seen: ConfirmationVersion,
  event: ConfirmationAnswerEvent,
  values: Pick<TaskUpdate, "proposedStartDate" | "proposedWorkdays" | "proposalNote" | "proposalSubmittedAt"> & {
    readonly respondedAt: string
  }
): Promise<"recorded" | "already_recorded" | "schedule_changed"> {
  const rule = confirmationMachine.transitions[event]
  const { respondedAt, ...proposal } = values
  const sameRequest = and(
    eq(scheduleTasks.id, seen.id),
    eq(scheduleTasks.assignedUserId, seen.assignedUserId),
    eq(scheduleTasks.startDate, seen.startDate),
    eq(scheduleTasks.workdays, seen.workdays),
    sameText(scheduleTasks.confirmationRequestedAt, seen.confirmationRequestedAt)
  )
  const result = await db
    .update(scheduleTasks)
    .set({ ...proposal, confirmationStatus: rule.to, confirmationRespondedAt: respondedAt, updatedAt: respondedAt })
    .where(
      and(
        sameRequest,
        eq(scheduleTasks.confirmationRequired, true),
        inArray(scheduleTasks.confirmationStatus, [...rule.from]),
        sameText(scheduleTasks.confirmationRespondedAt, seen.confirmationRespondedAt)
      )
    )
    .run()
  if (result.meta.changes > 0) return "recorded"
  const latest = await db
    .select({ id: scheduleTasks.id })
    .from(scheduleTasks)
    .where(and(sameRequest, eq(scheduleTasks.confirmationStatus, rule.to)))
    .get()
  return latest ? "already_recorded" : "schedule_changed"
}

/** Staff turned a proposal down: asked again. False when no proposal is waiting. */
export async function rejectConfirmationProposal(db: Db, taskId: string, now: string): Promise<boolean> {
  const rule = confirmationMachine.transitions.reject_proposal
  const result = await db
    .update(scheduleTasks)
    .set({
      confirmationStatus: rule.to,
      confirmationRespondedAt: null,
      proposedStartDate: null,
      proposedWorkdays: null,
      proposalNote: null,
      proposalSubmittedAt: null,
      updatedAt: now,
    })
    .where(and(eq(scheduleTasks.id, taskId), inArray(scheduleTasks.confirmationStatus, [...rule.from])))
    .run()
  return result.meta.changes > 0
}

/**
 * Staff accept the proposal they reviewed (submitted at `seenSubmittedAt`):
 * it lands only while that proposal still waits, so an answer the assignee
 * gave meanwhile stands. `event` is accept_proposal (asked again on the new
 * dates) or stop (no answer needed any more). The item's other edits and the
 * new dates are written after this lands. False when the assignee answered.
 */
export async function acceptConfirmationProposal(
  db: Db,
  taskId: string,
  seenSubmittedAt: string,
  event: "accept_proposal" | "stop",
  now: string
): Promise<boolean> {
  const rule = confirmationMachine.transitions.accept_proposal
  const result = await db
    .update(scheduleTasks)
    .set({
      confirmationStatus: confirmationStatusAfter(event),
      confirmationRequestedAt: event === "stop" ? null : now,
      confirmationRespondedAt: null,
      reminderSentAt: null,
      proposedStartDate: null,
      proposedWorkdays: null,
      proposalNote: null,
      proposalSubmittedAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(scheduleTasks.id, taskId),
        inArray(scheduleTasks.confirmationStatus, [...rule.from]),
        eq(scheduleTasks.proposalSubmittedAt, seenSubmittedAt)
      )
    )
    .run()
  return result.meta.changes > 0
}

/**
 * Puts back the proposal acceptConfirmationProposal took when the save it
 * belonged to failed before the item's new dates landed: only while nothing
 * else touched the item since (its updated_at is still the save's `now`, no
 * answer came in) and the same account is assigned.
 */
export async function restoreConfirmationProposal(
  db: Db,
  before: Pick<
    typeof scheduleTasks.$inferSelect,
    | "id" | "assignedUserId" | "confirmationRequestedAt" | "confirmationRespondedAt" | "reminderSentAt"
    | "proposedStartDate" | "proposedWorkdays" | "proposalNote" | "proposalSubmittedAt" | "updatedAt"
  >,
  now: string
): Promise<boolean> {
  const { id, assignedUserId, updatedAt, ...proposal } = before
  const result = await db
    .update(scheduleTasks)
    .set({ ...proposal, confirmationStatus: confirmationMachine.transitions.propose.to, updatedAt })
    .where(
      and(
        eq(scheduleTasks.id, id),
        eq(scheduleTasks.updatedAt, now),
        isNull(scheduleTasks.proposalSubmittedAt),
        isNull(scheduleTasks.confirmationRespondedAt),
        sameText(scheduleTasks.assignedUserId, assignedUserId)
      )
    )
    .run()
  return result.meta.changes > 0
}

function sameText(column: SQLiteColumn, value: string | null): SQL | undefined {
  return value === null ? isNull(column) : eq(column, value)
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
 * Sets one assignee (or none) on each task: the people list and the legacy
 * scalar columns, and removes its normalized assignees in the same batch,
 * since those rows carry their own response authority.
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
      ...replaceTaskPeopleQueries(
        db,
        task.id,
        assignedTo ? [namedAssignee(assignedTo)] : [],
        now
      ),
      db
        .update(scheduleTasks)
        .set({
          assignedTo,
          assignedUserId: null,
          // A bulk assignee is a name only: the request waits for an account.
          confirmationStatus: confirmationStatusAfter(task.confirmationRequired ? "await_account" : "stop"),
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

// ---------------------------------------------------------------------------
// Date moves (date-moves.ts): every start date, workdays and end date write
// ---------------------------------------------------------------------------

/**
 * One item's new dates. The single-assignee re-ask rides in the same UPDATE:
 * SQLite evaluates SET expressions against the row as it was, so the CASE
 * sees the old dates and status. Numbered parameters keep one set of values.
 */
function dateWriteStatement(database: D1Database, projectId: string, taskId: string, dates: DateMove, now: string, rules: DateMoveRules): D1PreparedStatement {
  const rule = confirmationMachine.transitions.dates_moved
  const reask = `(?7 = 1 AND confirmation_required = 1 AND assigned_user_id IS NOT NULL
    AND confirmation_status IN (${rule.from.map((_, index) => `?${index + 8}`).join(", ")})
    AND (start_date IS NOT ?1 OR end_date_calculated IS NOT ?2 OR workdays IS NOT COALESCE(?3, workdays)))`
  const cleared = ["confirmation_responded_at", "reminder_sent_at", "proposed_start_date", "proposed_workdays", "proposal_note", "proposal_submitted_at"]
  return database
    .prepare(
      `UPDATE schedule_tasks
       SET confirmation_status = CASE WHEN ${reask} THEN ?${rule.from.length + 8} ELSE confirmation_status END,
           confirmation_requested_at = CASE WHEN ${reask} THEN ?4 ELSE confirmation_requested_at END,
           ${cleared.map((column) => `${column} = CASE WHEN ${reask} THEN NULL ELSE ${column} END`).join(", ")},
           start_date = ?1, end_date_calculated = ?2, workdays = COALESCE(?3, workdays), updated_at = ?4
       WHERE id = ?5 AND project_id = ?6`
    )
    .bind(dates.startDate, dates.endDateCalculated, dates.workdays ?? null, now, taskId, projectId, rules.reaskOnDateMove ? 1 : 0, ...rule.from, rule.to)
}

/** After a group's dates land: multi-assignee rows answered for other dates than the item now has are asked again. */
function assigneeResetStatement(database: D1Database, projectId: string, taskIds: readonly string[], now: string): D1PreparedStatement {
  const current = (column: string): string => `(SELECT task.${column} FROM schedule_tasks AS task WHERE task.id = schedule_task_assignees.schedule_task_id)`
  return database
    .prepare(
      `UPDATE schedule_task_assignees
       SET source_start_date = ${current("start_date")}, source_workdays = ${current("workdays")}, source_end_date = ${current("end_date_calculated")},
           response_status = ?, date_response_status = ?, duration_response_status = ?,
           proposed_start_date = NULL, proposed_workdays = NULL, proposed_end_date = NULL,
           response_message = NULL, responded_at = NULL, responded_by_user_id = NULL, response_source = NULL,
           assigned_at = ?, updated_at = ?
       WHERE schedule_task_id IN (${taskIds.map(() => "?").join(", ")})
         AND EXISTS (SELECT 1 FROM schedule_tasks AS task WHERE task.id = schedule_task_assignees.schedule_task_id AND task.project_id = ?
           AND (task.start_date IS NOT source_start_date OR task.workdays IS NOT source_workdays OR task.end_date_calculated IS NOT source_end_date))`
    )
    .bind(RESET.responseStatus, RESET.dateResponseStatus, RESET.durationResponseStatus, now, now, ...taskIds, projectId)
}

/** One group: linked to-dos first (offsets from the previous dates), then the dates, then the multi-assignee re-ask. */
function dateMoveStatements(database: D1Database, projectId: string, group: readonly (readonly [string, DateMove])[], now: string, rules: DateMoveRules, linkedTodos: "shift" | "leave"): D1PreparedStatement[] {
  return [
    ...group.flatMap(([taskId, dates]) => [
      ...(linkedTodos === "shift" ? [linkedTodoDateUpdateStatement(database, { scheduleTaskId: taskId, nextStartDate: dates.startDate, nextEndDate: dates.endDateCalculated, updatedAt: now })] : []),
      dateWriteStatement(database, projectId, taskId, dates, now, rules),
    ]),
    ...(rules.reaskOnDateMove && group.length > 0 ? [assigneeResetStatement(database, projectId, group.map(([taskId]) => taskId), now)] : []),
  ]
}

function assertDateMovesFit(moves: DateMoves): void {
  const error = dateMovesLimitError(moves)
  if (error) throw new Error(error)
}

/** Runs `leading` (a dependency or calendar change) atomically with the first group of the moves it causes; later groups follow. */
export async function runWithDateUpdates(database: D1Database, leading: D1PreparedStatement, projectId: string, updates: DateMoves, updatedAt: string, failureMessage: string, rules: DateMoveRules): Promise<void> {
  assertDateMovesFit(updates)
  const [first = [], ...rest] = itemGroups([...updates])
  await runD1Batch(database, [leading, ...dateMoveStatements(database, projectId, first, updatedAt, rules, "shift")], failureMessage)
  for (const group of rest) await runD1Batch(database, dateMoveStatements(database, projectId, group, updatedAt, rules, "shift"), failureMessage)
}

/** Persists moves in order, a group at a time (put the edited item first). The agent API leaves linked to-dos ("leave"). */
export async function persistScheduleDateUpdates(database: D1Database, projectId: string, updates: DateMoves, updatedAt: string, rules: DateMoveRules, linkedTodos: "shift" | "leave" = "shift"): Promise<void> {
  assertDateMovesFit(updates)
  for (const group of itemGroups([...updates])) {
    await runD1Batch(database, dateMoveStatements(database, projectId, group, updatedAt, rules, linkedTodos), "Schedule date update batch failed")
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

/**
 * A task created from a schedule template, for a template application batch.
 * Its placeholder name stays in assigned_to only (readers fall back to it), so
 * the atomic batch does not grow with a statement per item.
 */
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
        ?, ?, 0, ?, ?, ?, ?, ?)`
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
      confirmationMachine.initial,
      task.sortOrder,
      now,
      now,
      notes
    )
}

// ---------------------------------------------------------------------------
// Task people (everyone assigned) and normalized assignees
// ---------------------------------------------------------------------------

/**
 * Replaces a task's people with `people`, in order: one delete, then the
 * inserts. The caller batches them with the task's assigned_to update.
 */
export function replaceTaskPeopleQueries(
  db: Db,
  taskId: string,
  people: readonly ScheduleTaskPersonData[],
  now: string
): BatchItem<"sqlite">[] {
  const rows = people.map((person, position) => ({
    id: crypto.randomUUID(),
    scheduleTaskId: taskId,
    position,
    displayName: person.name,
    assignedUserId: person.assignedUserId,
    projectContactId: person.projectContactId,
    teamId: person.teamId,
    createdAt: now,
  }))
  return [
    db.delete(scheduleTaskPeople).where(eq(scheduleTaskPeople.scheduleTaskId, taskId)),
    ...chunkD1InsertRows(scheduleTaskPeople, rows).map((chunk) => db.insert(scheduleTaskPeople).values(chunk)),
  ]
}

/** Sets a task's single assigned_to and its people list together. */
export async function setTaskAssignedTo(
  db: Db,
  taskId: string,
  assignedTo: string | null,
  now: string
): Promise<void> {
  const [first, ...rest] = replaceTaskPeopleQueries(
    db,
    taskId,
    assignedTo ? [namedAssignee(assignedTo)] : [],
    now
  )
  if (first) await db.batch([first, ...rest])
}

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
      ...RESET,
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

/**
 * The assignment as the assignee answered it, read before they answered:
 * the row's assigned_at (set again by every reset), its last responded_at,
 * and the item's dates.
 */
export type AssigneeResponseVersion = {
  readonly id: string
  readonly assignedAt: string
  readonly respondedAt: string | null
  readonly startDate: string
  readonly workdays: number
}

/**
 * Records an assignee's answer (assignee-response-machine.ts). It lands only
 * while the row and its item are still at `seen`. Otherwise it reports
 * "already_recorded" when the same person's same answer landed first (a
 * double submit), and "schedule_changed" when staff moved, re-asked or
 * reassigned in the meantime, or another answer landed.
 */
export async function recordAssigneeResponse(
  db: Db,
  seen: AssigneeResponseVersion,
  answer: {
    readonly event: AssigneeAnswerEvent
    readonly dateResponseStatus: ScheduleAssigneeResponseStatus
    readonly durationResponseStatus: ScheduleAssigneeResponseStatus
    readonly proposedStartDate: string | null
    readonly proposedWorkdays: number | null
    readonly responseMessage: string | null
  },
  by: { readonly respondedAt: string; readonly respondedByUserId: string; readonly responseSource: string }
): Promise<"recorded" | "already_recorded" | "schedule_changed"> {
  const rule = assigneeResponseMachine.transitions[answer.event]
  const result = await db
    .update(scheduleTaskAssignees)
    .set({
      responseStatus: rule.to,
      dateResponseStatus: answer.dateResponseStatus,
      durationResponseStatus: answer.durationResponseStatus,
      proposedStartDate: answer.proposedStartDate,
      proposedWorkdays: answer.proposedWorkdays,
      responseMessage: answer.responseMessage,
      ...by,
      updatedAt: by.respondedAt,
    })
    .where(
      and(
        eq(scheduleTaskAssignees.id, seen.id),
        inArray(scheduleTaskAssignees.responseStatus, [...rule.from]),
        eq(scheduleTaskAssignees.assignedAt, seen.assignedAt),
        sameText(scheduleTaskAssignees.respondedAt, seen.respondedAt),
        exists(
          db
            .select({ id: scheduleTasks.id })
            .from(scheduleTasks)
            .where(
              and(
                eq(scheduleTasks.id, scheduleTaskAssignees.scheduleTaskId),
                eq(scheduleTasks.startDate, seen.startDate),
                eq(scheduleTasks.workdays, seen.workdays)
              )
            )
        )
      )
    )
    .run()
  if (result.meta.changes > 0) return "recorded"
  const latest = await db
    .select({
      assignedAt: scheduleTaskAssignees.assignedAt,
      responseStatus: scheduleTaskAssignees.responseStatus,
      respondedByUserId: scheduleTaskAssignees.respondedByUserId,
    })
    .from(scheduleTaskAssignees)
    .where(eq(scheduleTaskAssignees.id, seen.id))
    .get()
  const sameAnswer =
    latest?.assignedAt === seen.assignedAt &&
    latest.respondedByUserId === by.respondedByUserId &&
    latest.responseStatus === rule.to
  return sameAnswer ? "already_recorded" : "schedule_changed"
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
