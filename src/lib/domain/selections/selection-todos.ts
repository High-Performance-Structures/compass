/**
 * Selections create real to-dos in the existing to-do framework
 * (project_operations staff tasks, written through the operations store,
 * with the same numbering and "created" history event as the To-dos page).
 * A to-do links to its selection by source_record_id; its payload names the
 * selection step it is for, so the same open step is not created twice.
 * Finishing a to-do stays a person's decision: nothing here closes one.
 */
import { and, asc, eq, inArray, or, sql } from "drizzle-orm"

import { projectOperations, projects } from "@/db/schema"
import { countProjectOperations } from "@/lib/domain/operations/queries"
import { projectTaskNumberFor } from "@/lib/domain/operations/rules"
import { archiveTodos, insertOperationUnlessDuplicate, recordTodoEvent } from "@/lib/domain/operations/store"
import { chunkD1Values } from "@/lib/d1-query"
import { PROJECT_TODO_RECORD_TYPES } from "@/lib/project-todos"
import { recordStatusColor, recordStatusLabel } from "@/lib/domain/record-statuses/rules"
import type { RecordStatusColor } from "@/lib/domain/record-statuses/statuses"
import { loadRecordStatusListForProject } from "@/lib/domain/record-statuses/store"
import { isArchivedTodoStatus, isCompletedTodoStatus } from "@/lib/project-todo-statuses"
import type { Db } from "@/lib/server/action-context"

/** The selection steps that make a to-do. */

export type SelectionTodoStep = "price_choices" | "order" | "owner_question" | "order_lead_time" | "replacement_change_order" | "price_owner_suggestion"

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
  replacement_change_order: {
    title: "Create a change order for this replacement:",
    description: "A new selection replaces an approved, ordered or installed one. Write the change order for it on the change-order screens and send it for the owner's signature.",
    priority: "high",
  },
  price_owner_suggestion: {
    title: "Price owner's suggested choice:",
    description:
      "The owner added their own choice. Set its owner price (supplier price plus markup) in the choice's edit form; until then the owner sees \"Pending staff pricing\" and the Selection Phase can't go out for signature with it picked. The product page's price is only the supplier price.",
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
        // Its own to-dos, and a replacement's change-order to-do on the selection it replaces.
        or(
          eq(projectOperations.sourceRecordId, selectionId),
          sql`json_extract(${projectOperations.sagePayloadJson}, '$.replacedSelectionId') = ${selectionId}`,
        ),
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

/** The selection's to-dos for a step (any status). */
async function stepTodos(db: Db, projectId: string, selectionIds: readonly string[], step: SelectionTodoStep) {
  // Chunked: a bulk delete can pass more ids than one D1 statement binds.
  const chunks = await Promise.all(chunkD1Values(selectionIds).map((ids) => stepTodosChunk(db, projectId, ids, step)))
  return chunks.flat()
}

async function stepTodosChunk(db: Db, projectId: string, selectionIds: readonly string[], step: SelectionTodoStep) {
  return db
    .select({
      id: projectOperations.id,
      projectId: projectOperations.projectId,
      status: projectOperations.status,
      onceKey: sql<string | null>`json_extract(${projectOperations.sagePayloadJson}, '$.selectionStepKey')`,
    })
    .from(projectOperations)
    .where(
      and(
        eq(projectOperations.projectId, projectId),
        inArray(projectOperations.sourceRecordId, [...selectionIds]),
        eq(projectOperations.sourceRecordType, "staff_task"),
        sql`json_extract(${projectOperations.sagePayloadJson}, '$.selectionStep') = ${step}`,
      ),
    )
}

/**
 * Whether the selection has a to-do for the step that wasn't archived (open
 * or done). A replacement without one can have its change-order to-do made
 * from its drawer.
 */
export async function hasSelectionStepTodo(db: Db, projectId: string, selectionId: string, step: SelectionTodoStep): Promise<boolean> {
  const statuses = await loadRecordStatusListForProject(db, projectId, "todo")
  const rows = await stepTodos(db, projectId, [selectionId], step)
  return rows.some((row) => !isArchivedTodoStatus(statuses, row.status))
}

/**
 * Archives the open change-order to-dos of replacements being deleted: with
 * the replacement gone there is no change order to write. Done ones stay.
 */
export async function archiveReplacementTodos(db: Db, projectId: string, selectionIds: readonly string[], now: string): Promise<void> {
  if (selectionIds.length === 0) return
  const statuses = await loadRecordStatusListForProject(db, projectId, "todo")
  const open = (await stepTodos(db, projectId, selectionIds, "replacement_change_order"))
    .filter((row) => !isCompletedTodoStatus(statuses, row.status) && !isArchivedTodoStatus(statuses, row.status))
  await archiveTodos(db, projectId, open, now)
}

/**
 * Archives the open to-do to price an owner's suggested choice (keyed by the
 * choice) once the suggestion is deleted. Done ones stay.
 */
export async function archiveOwnerSuggestionTodo(db: Db, projectId: string, selectionId: string, choiceId: string, now: string): Promise<void> {
  const statuses = await loadRecordStatusListForProject(db, projectId, "todo")
  const open = (await stepTodos(db, projectId, [selectionId], "price_owner_suggestion")).filter(
    (row) => row.onceKey === ownerSuggestionTodoKey(choiceId) && !isCompletedTodoStatus(statuses, row.status) && !isArchivedTodoStatus(statuses, row.status),
  )
  await archiveTodos(db, projectId, open, now)
}

/** The once-key of the to-do to price one owner suggestion. */
export function ownerSuggestionTodoKey(choiceId: string): string {
  return `owner-suggestion:${choiceId}`
}

/**
 * Creates the step's to-do for the selection unless one is still open.
 * Assigned to `assigneeName` when given (null leaves it unassigned), else to
 * the project manager named on the job. Returns the new to-do's id, or null
 * when an open one already exists.
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
    /** Who it is assigned to (a name; null for no one); the project manager named on the job when left out. */
    readonly assigneeName?: string | null
    /** The selection a replacement replaces: the to-do shows on both. */
    readonly replacedSelectionId?: string
    /**
     * With `onceKey`: one to-do per key rather than per step, so another
     * open to-do for the step (a different key, e.g. another owner
     * suggestion on the same selection) doesn't stop this one.
     */
    readonly perKey?: boolean
  },
): Promise<string | null> {
  const statuses = await loadRecordStatusListForProject(db, input.projectId, "todo")
  const all = await stepTodos(db, input.projectId, [input.selectionId], input.step)
  const perKey = input.perKey === true && input.onceKey !== undefined
  const open = perKey ? all.filter((row) => row.onceKey === input.onceKey) : all
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
  // Atomic against a double click or a concurrent request: when another
  // to-do for the step landed since the read above, this one is taken back.
  const sameKey = perKey ? sql` AND json_extract(step_todo.sage_payload_json, '$.selectionStepKey') = ${input.onceKey}` : sql``
  const duplicate = sql`(SELECT count(*) FROM project_operations AS step_todo WHERE step_todo.project_id = ${input.projectId} AND step_todo.source_record_id = ${input.selectionId} AND step_todo.source_record_type = 'staff_task' AND json_extract(step_todo.sage_payload_json, '$.selectionStep') = ${input.step}${sameKey}) > ${open.length + 1}`
  const kept = await insertOperationUnlessDuplicate(db, {
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
    assigneeName: input.assigneeName !== undefined ? input.assigneeName : project.projectManager,
    dueDate: input.dueDate ?? null,
    sageJobId: project.sageJobId,
    sageJobNumber: project.sageJobNumber,
    sageWriteStatus: "not_ready",
    sagePayloadJson: JSON.stringify({
      source: "compass_finish_selection",
      selectionId: input.selectionId,
      selectionStep: input.step,
      ...(input.onceKey !== undefined ? { selectionStepKey: input.onceKey } : {}),
      ...(input.replacedSelectionId !== undefined ? { replacedSelectionId: input.replacedSelectionId } : {}),
      taskType: "staff_task",
      title,
    }),
    syncDirection: "write",
    syncStatus: "compass_only",
    createdAt: input.now,
    updatedAt: input.now,
  }, duplicate)
  if (!kept) return null
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
