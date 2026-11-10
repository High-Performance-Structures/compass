/**
 * Selections create real to-dos in the existing to-do framework
 * (project_operations staff tasks, written through the operations store,
 * with the same numbering and "created" history event as the To-dos page).
 * A to-do links to its selection by source_record_id; its payload names the
 * selection step it is for, so the same open step is not created twice.
 * Finishing a to-do stays a person's decision: nothing here closes one.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm"

import { projectOperations, projects } from "@/db/schema"
import { countProjectOperations } from "@/lib/domain/operations/queries"
import { projectTaskNumberFor } from "@/lib/domain/operations/rules"
import { insertOperations, recordTodoEvent } from "@/lib/domain/operations/store"
import { PROJECT_TODO_RECORD_TYPES } from "@/lib/project-todos"
import { recordStatusColor, recordStatusLabel } from "@/lib/domain/record-statuses/rules"
import type { RecordStatusColor } from "@/lib/domain/record-statuses/statuses"
import { loadRecordStatusListForProject } from "@/lib/domain/record-statuses/store"
import { isArchivedTodoStatus, isCompletedTodoStatus } from "@/lib/project-todo-statuses"
import type { Db } from "@/lib/server/action-context"

/** The selection steps that make a to-do. */

export type SelectionTodoStep = "price_choices" | "order" | "owner_question" | "order_lead_time"

const STEP_TEXT: Readonly<Record<SelectionTodoStep, { readonly title: string; readonly description: string; readonly priority: string }>> = {
  price_choices: {
    title: "Price choices for",
    description: "Enter a price for each choice, or ask the supplier to price them through an RFQ.",
    priority: "normal",
  },
  order: {
    title: "Order",
    description: "The owner approved this selection. Order it from the supplier at the accepted price.",
    priority: "high",
  },
  owner_question: {
    title: "Answer owner question on",
    description: "The owner commented on this selection. Reply in the selection's comments.",
    priority: "high",
  },
  order_lead_time: {
    title: "Place long-lead order for",
    description: "This selection has a long lead time. Order it soon so it arrives in time.",
    priority: "high",
  },
}

/** The to-do title for a step, e.g. "Order Backsplash tile". */
function selectionTodoTitle(step: SelectionTodoStep, selectionName: string): string {
  return `${STEP_TEXT[step].title} ${selectionName}`
}

export type SelectionTodoView = {
  readonly id: string
  readonly number: string | null
  readonly title: string
  readonly status: string
  /** The company's label and color for the status (Settings > Statuses). */
  readonly statusLabel: string
  readonly statusColor: RecordStatusColor
  readonly assigneeName: string | null
  readonly dueDate: string | null
  readonly done: boolean
}

/** Every to-do linked to the selection, oldest first. */
export async function loadSelectionTodos(db: Db, projectId: string, selectionId: string): Promise<readonly SelectionTodoView[]> {
  const statuses = await loadRecordStatusListForProject(db, projectId, "todo")
  const rows = await db
    .select({
      id: projectOperations.id,
      number: projectOperations.sourceRecordNumber,
      title: projectOperations.title,
      status: projectOperations.status,
      assigneeName: projectOperations.assigneeName,
      dueDate: projectOperations.dueDate,
    })
    .from(projectOperations)
    .where(
      and(
        eq(projectOperations.projectId, projectId),
        eq(projectOperations.sourceRecordId, selectionId),
        inArray(projectOperations.sourceRecordType, [...PROJECT_TODO_RECORD_TYPES]),
      ),
    )
    .orderBy(asc(projectOperations.createdAt))
  return rows.map((row) => ({
    ...row,
    statusLabel: recordStatusLabel(statuses, row.status),
    statusColor: recordStatusColor(statuses, row.status),
    done: isCompletedTodoStatus(statuses, row.status) || isArchivedTodoStatus(statuses, row.status),
  }))
}

/**
 * Creates the step's to-do for the selection unless one is still open.
 * Assigned to the project manager named on the job. Returns the new to-do's
 * id, or null when an open one already exists.
 *
 * `onceKey` makes it once only: no new to-do while any to-do for the step
 * (open or finished) carries the same key. Scheduled checks use it so a
 * finished to-do is not made again on the next run.
 */
export async function ensureSelectionTodo(
  db: Db,
  input: {
    readonly projectId: string
    readonly selectionId: string
    readonly selectionName: string
    readonly step: SelectionTodoStep
    readonly actorId: string | null
    readonly now: string
    readonly onceKey?: string
    readonly dueDate?: string | null
    /** Replaces the step's standard description. */
    readonly description?: string
  },
): Promise<string | null> {
  const statuses = await loadRecordStatusListForProject(db, input.projectId, "todo")
  const open = await db
    .select({
      id: projectOperations.id,
      status: projectOperations.status,
      onceKey: sql<string | null>`json_extract(${projectOperations.sagePayloadJson}, '$.selectionStepKey')`,
    })
    .from(projectOperations)
    .where(
      and(
        eq(projectOperations.projectId, input.projectId),
        eq(projectOperations.sourceRecordId, input.selectionId),
        eq(projectOperations.sourceRecordType, "staff_task"),
        sql`json_extract(${projectOperations.sagePayloadJson}, '$.selectionStep') = ${input.step}`,
      ),
    )
  if (open.some((row) => !isCompletedTodoStatus(statuses, row.status) && !isArchivedTodoStatus(statuses, row.status))) return null
  if (input.onceKey !== undefined && open.some((row) => row.onceKey === input.onceKey)) return null

  const [project, taskCount] = await Promise.all([
    db
      .select({
        organizationId: projects.organizationId,
        projectManager: projects.projectManager,
        sageJobId: projects.sageJobId,
        sageJobNumber: projects.sageJobNumber,
      })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .get(),
    countProjectOperations(db, input.projectId, PROJECT_TODO_RECORD_TYPES),
  ])
  if (!project) return null

  const text = STEP_TEXT[input.step]
  const id = crypto.randomUUID()
  const title = selectionTodoTitle(input.step, input.selectionName)
  await insertOperations(db, {
    id,
    projectId: input.projectId,
    sourceSystem: "compass",
    sourceRecordType: "staff_task",
    sourceRecordId: input.selectionId,
    sourceRecordNumber: projectTaskNumberFor(taskCount),
    title,
    description: input.description ?? text.description,
    status: "open",
    priority: text.priority,
    assigneeType: "internal",
    assigneeName: project.projectManager,
    dueDate: input.dueDate ?? null,
    sageJobId: project.sageJobId,
    sageJobNumber: project.sageJobNumber,
    sageWriteStatus: "not_ready",
    sagePayloadJson: JSON.stringify({
      source: "compass_finish_selection",
      selectionId: input.selectionId,
      selectionStep: input.step,
      ...(input.onceKey !== undefined ? { selectionStepKey: input.onceKey } : {}),
      taskType: "staff_task",
      title,
    }),
    syncDirection: "write",
    syncStatus: "compass_only",
    createdAt: input.now,
    updatedAt: input.now,
  })
  if (project.organizationId) {
    await recordTodoEvent(db, {
      organizationId: project.organizationId,
      projectId: input.projectId,
      todoId: id,
      kind: "created",
      dailyLogId: null,
      fromStatus: null,
      toStatus: "open",
      note: null,
      actorId: input.actorId,
      createdAt: input.now,
    })
  }
  return id
}
