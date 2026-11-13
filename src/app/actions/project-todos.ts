"use server"

import { and, eq } from "drizzle-orm"

import { projectOperations } from "@/db/schema"
import { errorMessage } from "@/lib/action-result"
import { dailyLogCostCodeOptions } from "@/lib/daily-logs/cost-code-lines"
import { loadProjectTodoHistory, loadTodoHours, loadTodoWorkedLogCounts } from "@/lib/daily-logs/log-followups-server"
import { isDemoUser } from "@/lib/demo"
import { operationsContext } from "@/lib/domain/operations/access"
import { changeProjectTodosCommand, type BulkTodoInput, type BulkTodoResult } from "@/lib/domain/operations/bulk-todos"
import {
  loadProjectOperation,
  loadProjectTodos,
  loadScheduleTaskTodos,
} from "@/lib/domain/operations/queries"
import {
  assigneeTypeForTask,
  cleanDate,
  normalizeTaskRecordType,
  requireText,
} from "@/lib/domain/operations/rules"
import { deleteOperationsReturning, setTodoStatusByStaff, type OperationRow } from "@/lib/domain/operations/store"
import type {
  CreateProjectTaskInput,
  ProjectOperationActionResult,
  ProjectTodoActionResult,
  ProjectTodoDetail,
  ProjectTodoItem,
  UpdateProjectTodoInput,
} from "@/lib/domain/operations/types"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { notifyProjectAssignment } from "@/lib/notifications/events"
import { createProjectTaskCommand, revalidateProjectTodoPaths } from "@/lib/domain/operations/todo-commands"
import { isProjectTodoRecordType } from "@/lib/project-todos"
import { isArchivedTodoStatus } from "@/lib/project-todo-statuses"
import { isSelectableRecordStatus, type RecordStatusList } from "@/lib/domain/record-statuses/rules"
import { loadRecordStatusList } from "@/lib/domain/record-statuses/store"
import { getCurrentUser } from "@/lib/auth"
import type { Db } from "@/lib/server/action-context"
import { cleanText } from "@/lib/shared/guards"
import { canFeature } from "@/lib/permission-enforcement"

/*
 * Project to-dos: staff of the project's organization with the "tasks"
 * permission read and change them (operations access, "organization" scope).
 */

/** A to-do edit only lands on the version the person opened. */
function sameVersion(projectId: string, todoId: string, expectedUpdatedAt: string) {
  return and(
    eq(projectOperations.id, todoId),
    eq(projectOperations.projectId, projectId),
    eq(projectOperations.updatedAt, expectedUpdatedAt),
  )
}

export async function getProjectTodos(projectId: string): Promise<readonly ProjectTodoItem[]> {
  let db: Db
  try {
    ;({ db } = await operationsContext(projectId, "tasks", false))
  } catch (error) {
    // The demo browses other demo projects' links; a missing one is an empty list.
    const user = await getCurrentUser()
    if (user && isDemoUser(user.id) && error instanceof Error && error.message === "Project not found") return []
    throw error
  }
  return loadProjectTodos(db, projectId)
}

export async function getProjectTodoDetail(projectId: string, todoId: string): Promise<ProjectTodoDetail> {
  const { db, organizationId } = await operationsContext(projectId, "tasks", false)
  const [history, hours, workedCounts, settings, costCodes] = await Promise.all([
    loadProjectTodoHistory(db, projectId, todoId),
    loadTodoHours(db, projectId),
    loadTodoWorkedLogCounts(db, projectId),
    readFeatureSettings(db, organizationId, "daily-log-followups"),
    dailyLogCostCodeOptions(db, organizationId, projectId),
  ])
  return {
    history,
    hours: hours.get(todoId) ?? 0,
    workedLogCount: workedCounts.get(todoId) ?? 0,
    finishNudgeAfterLogs: settings.finishNudgeAfterLogs,
    costCodes: settings.todoCostCodes ? costCodes : [],
  }
}

export async function getScheduleTaskTodos(
  projectId: string,
  scheduleTaskId: string,
): Promise<readonly ProjectTodoItem[]> {
  const { db } = await operationsContext(projectId, "tasks", false)
  return loadScheduleTaskTodos(db, projectId, scheduleTaskId)
}

export async function createProjectTask(
  projectId: string,
  input: CreateProjectTaskInput,
): Promise<ProjectOperationActionResult> {
  return createProjectTaskCommand(projectId, input)
}

async function findEditableProjectTodo(
  projectId: string,
  todoId: string,
  expectedUpdatedAt: string,
): Promise<Awaited<ReturnType<typeof operationsContext>> & { readonly operation: OperationRow; readonly statuses: RecordStatusList }> {
  const context = await operationsContext(projectId, "tasks", true)
  const [operation, statuses] = await Promise.all([
    loadProjectOperation(context.db, projectId, todoId),
    loadRecordStatusList(context.db, context.organizationId, "todo"),
  ])
  if (!operation || !isProjectTodoRecordType(operation.sourceRecordType)) {
    throw new Error("To-do not found")
  }
  if (operation.updatedAt !== expectedUpdatedAt) {
    throw new Error("This to-do changed after you opened it. Refresh and review the latest version.")
  }
  return { ...context, operation, statuses }
}

const CHANGED_WHILE_SAVING = "This to-do changed while you were saving. Refresh and review the latest version."

export async function changeProjectTodos(projectId: string, input: BulkTodoInput): Promise<BulkTodoResult> {
  return changeProjectTodosCommand(projectId, input)
}

export async function updateProjectTodo(
  projectId: string,
  todoId: string,
  input: UpdateProjectTodoInput,
): Promise<ProjectTodoActionResult> {
  try {
    const { db, user, organizationId, operation, statuses } = await findEditableProjectTodo(
      projectId,
      todoId,
      input.expectedUpdatedAt,
    )
    // One of the company's visible to-do statuses (Settings › Statuses), or the to-do's own.
    if (!isSelectableRecordStatus(statuses, input.status, operation.status)) {
      return { success: false, error: "Choose a valid to-do status." }
    }
    const sourceRecordType = normalizeTaskRecordType(input.sourceRecordType)
    const title = requireText(input.title, "Title")
    const assigneeName = cleanText(input.assigneeName)
    const companyName = cleanText(input.companyName)
    const startDate = cleanDate(input.startDate, "Start date")
    const dueDate = cleanDate(input.dueDate, "Due date")
    if (startDate && dueDate && dueDate < startDate) {
      return { success: false, error: "Due date must be on or after the start date." }
    }

    const updatedAt = new Date().toISOString()
    const updated = await setTodoStatusByStaff(db, {
      projectId,
      todoId,
      expectedUpdatedAt: input.expectedUpdatedAt,
      expectedStatus: operation.status,
      status: input.status,
      values: {
        sourceRecordType,
        title,
        description: cleanText(input.description),
        priority: cleanText(input.priority) ?? "normal",
        assigneeType: assigneeTypeForTask(sourceRecordType),
        assigneeName,
        companyName,
        startDate,
        dueDate,
        ...(input.costCode !== undefined ? { costCode: cleanText(input.costCode) } : {}),
      },
      history: input.status === operation.status ? null : {
        organizationId,
        projectId,
        todoId,
        kind: "status",
        dailyLogId: null,
        fromStatus: operation.status,
        toStatus: input.status,
        note: null,
        actorId: user.id,
        createdAt: updatedAt,
      },
      updatedAt,
    })
    if (!updated) return { success: false, error: CHANGED_WHILE_SAVING }

    if (assigneeName && assigneeName !== operation.assigneeName) {
      try {
        await notifyProjectAssignment({
          organizationId,
          projectId,
          itemId: todoId,
          title,
          assignedToName: assigneeName,
          createdBy: user,
          kind: "task",
        })
      } catch (notificationError) {
        console.error("Updated project task assignment notification failed:", notificationError)
      }
    }

    revalidateProjectTodoPaths(projectId)
    return { success: true, id: updated.id, updatedAt: updated.updatedAt }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to update to-do") }
  }
}

/**
 * A person marks the to-do done (done is a manual decision): the built-in
 * "complete" status, even when the company hides it from status choices.
 */
export async function completeProjectTodo(
  projectId: string,
  todoId: string,
  expectedUpdatedAt: string,
): Promise<ProjectTodoActionResult> {
  return changeTodoStatus(projectId, todoId, "complete", expectedUpdatedAt)
}

/**
 * A built-in workflow step (done, restore) that saves its built-in key,
 * whatever the company shows as status choices. Status choices go through
 * updateProjectTodo, which accepts only the company's visible statuses.
 */
async function changeTodoStatus(
  projectId: string,
  todoId: string,
  status: "complete" | "open",
  expectedUpdatedAt: string,
): Promise<ProjectTodoActionResult> {
  try {
    const { db, user, organizationId, operation, statuses } = await findEditableProjectTodo(projectId, todoId, expectedUpdatedAt)
    if (!statuses.statuses.some((item) => item.key === status && item.builtIn)) {
      return { success: false, error: "Choose a valid to-do status." }
    }
    const updatedAt = new Date().toISOString()
    const updated = await setTodoStatusByStaff(db, {
      projectId,
      todoId,
      expectedUpdatedAt,
      expectedStatus: operation.status,
      status,
      history: status === operation.status ? null : {
        organizationId,
        projectId,
        todoId,
        kind: "status",
        dailyLogId: null,
        fromStatus: operation.status,
        toStatus: status,
        note: null,
        actorId: user.id,
        createdAt: updatedAt,
      },
      updatedAt,
    })
    if (!updated) return { success: false, error: CHANGED_WHILE_SAVING }

    revalidateProjectTodoPaths(projectId)
    return { success: true, id: updated.id, updatedAt: updated.updatedAt }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to change to-do status") }
  }
}

export async function archiveProjectTodo(
  projectId: string,
  todoId: string,
  expectedUpdatedAt: string,
): Promise<ProjectTodoActionResult> {
  try {
    const { db, operation } = await findEditableProjectTodo(projectId, todoId, expectedUpdatedAt)
    const updatedAt = new Date().toISOString()
    // Archiving writes no history, as the To-dos page's bulk archive.
    const updated = await setTodoStatusByStaff(db, {
      projectId,
      todoId,
      expectedUpdatedAt,
      expectedStatus: operation.status,
      status: "archived",
      history: null,
      updatedAt,
    })
    if (!updated) {
      return {
        success: false,
        error: "This to-do changed while you were archiving it. Refresh and review the latest version.",
      }
    }
    revalidateProjectTodoPaths(projectId)
    return { success: true, id: updated.id, updatedAt: updated.updatedAt }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to archive to-do") }
  }
}

export async function restoreProjectTodo(
  projectId: string,
  todoId: string,
  expectedUpdatedAt: string,
): Promise<ProjectTodoActionResult> {
  return changeTodoStatus(projectId, todoId, "open", expectedUpdatedAt)
}

export async function deleteProjectTodo(
  projectId: string,
  todoId: string,
  expectedUpdatedAt: string,
): Promise<ProjectTodoActionResult> {
  try {
    const { db, user, operation, statuses } = await findEditableProjectTodo(projectId, todoId, expectedUpdatedAt)
    if (!(await canFeature(user, "tasks", "delete"))) return { success: false, error: "You do not have permission to delete to-dos." }
    if (!isArchivedTodoStatus(statuses, operation.status)) {
      return { success: false, error: "Archive the to-do before deleting it permanently." }
    }
    const [deleted] = await deleteOperationsReturning(db, sameVersion(projectId, todoId, expectedUpdatedAt))
    if (!deleted) {
      return {
        success: false,
        error: "This to-do changed while you were deleting it. Refresh and review the latest version.",
      }
    }
    revalidateProjectTodoPaths(projectId)
    return { success: true, id: deleted.id, updatedAt: expectedUpdatedAt }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to delete to-do") }
  }
}
