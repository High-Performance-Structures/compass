"use server"

import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { dailyLogs, projectOperations } from "@/db/schema"
import { errorMessage } from "@/lib/action-result"
import { dailyLogCostCodeOptions } from "@/lib/daily-logs/cost-code-lines"
import { loadProjectTodoHistory, loadTodoHours, loadTodoWorkedLogCounts } from "@/lib/daily-logs/log-followups-server"
import { isDemoUser } from "@/lib/demo"
import { operationsContext } from "@/lib/domain/operations/access"
import {
  countProjectOperations,
  loadProjectOperation,
  loadProjectSageNumbers,
  loadProjectTodos,
  loadScheduleTaskTodos,
} from "@/lib/domain/operations/queries"
import {
  assigneeTypeForTask,
  cleanDate,
  normalizeTaskRecordType,
  projectTaskNumberFor,
  requireText,
} from "@/lib/domain/operations/rules"
import {
  deleteOperationsReturning,
  insertOperations,
  recordTodoEvent,
  updateOperationsReturning,
  type OperationRow,
} from "@/lib/domain/operations/store"
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
import {
  PROJECT_TODO_RECORD_TYPES,
  type ProjectTodoStatus,
  isArchivedProjectTodoStatus,
  isProjectTodoRecordType,
  isProjectTodoStatus,
} from "@/lib/project-todos"
import { getCurrentUser } from "@/lib/auth"
import type { Db } from "@/lib/server/action-context"
import { cleanText } from "@/lib/shared/guards"

/*
 * Project to-dos: staff of the project's organization with the "tasks"
 * permission read and change them (operations access, "organization" scope).
 */

function revalidateProjectTodoPaths(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}`)
  revalidatePath(`/dashboard/projects/${projectId}/todos`)
  revalidatePath(`/dashboard/projects/${projectId}/daily-logs`)
  revalidatePath(`/dashboard/projects/${projectId}/schedule`)
  revalidatePath("/dashboard")
  revalidatePath("/dashboard/schedule")
}

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
  try {
    const { db, user, organizationId } = await operationsContext(projectId, "tasks", true)
    const [project, taskCount] = await Promise.all([
      loadProjectSageNumbers(db, projectId),
      countProjectOperations(db, projectId, PROJECT_TODO_RECORD_TYPES),
    ])

    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const title = requireText(input.title, "Title")
    const sourceRecordType = normalizeTaskRecordType(input.sourceRecordType)
    const dueDate = cleanText(input.dueDate)
    const startDate = cleanText(input.startDate)
    const sourceRecordId = cleanText(input.sourceRecordId)
    const priority = cleanText(input.priority) ?? "normal"

    await insertOperations(db, {
      id,
      projectId,
      sourceSystem: "compass",
      sourceRecordType,
      sourceRecordId,
      sourceRecordNumber: projectTaskNumberFor(taskCount),
      title,
      description: cleanText(input.description),
      status: "open",
      priority,
      assigneeType: assigneeTypeForTask(sourceRecordType),
      assigneeName: cleanText(input.assigneeName),
      companyName: cleanText(input.companyName),
      startDate,
      dueDate,
      externalUrl: cleanText(input.externalUrl),
      sageJobId: project?.sageJobId ?? null,
      sageJobNumber: project?.sageJobNumber ?? null,
      sageWriteStatus: "not_ready",
      sagePayloadJson: JSON.stringify({
        source: "compass_task",
        linkedRecordId: sourceRecordId,
        linkedRecordNumber: cleanText(input.sourceRecordNumber),
        taskType: sourceRecordType,
        title,
        description: cleanText(input.description),
        assigneeName: cleanText(input.assigneeName),
        companyName: cleanText(input.companyName),
        startDate,
        dueDate,
        priority,
      }),
      syncDirection: "write",
      syncStatus: "compass_only",
      createdAt: now,
      updatedAt: now,
    })
    // Made from a daily log on this job: the history links back to it.
    const [sourceLog] = sourceRecordId
      ? await db
          .select({ id: dailyLogs.id })
          .from(dailyLogs)
          .where(and(eq(dailyLogs.id, sourceRecordId), eq(dailyLogs.projectId, projectId)))
          .limit(1)
      : []
    await recordTodoEvent(db, {
      organizationId,
      projectId,
      todoId: id,
      kind: "created",
      dailyLogId: sourceLog?.id ?? null,
      fromStatus: null,
      toStatus: "open",
      note: null,
      actorId: user.id,
      createdAt: now,
    })

    try {
      await notifyProjectAssignment({
        organizationId,
        projectId,
        itemId: id,
        title,
        assignedToName: cleanText(input.assigneeName),
        createdBy: user,
        kind: "task",
      })
    } catch (notificationError) {
      console.error("Project task assignment notification failed:", notificationError)
    }

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/rfis`)
    revalidatePath(`/dashboard/projects/${projectId}/rfqs`)
    revalidatePath(`/dashboard/projects/${projectId}/purchase-orders`)
    revalidateProjectTodoPaths(projectId)
    return { success: true, id }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Failed to create project task") }
  }
}

async function findEditableProjectTodo(
  projectId: string,
  todoId: string,
  expectedUpdatedAt: string,
): Promise<Awaited<ReturnType<typeof operationsContext>> & { readonly operation: OperationRow }> {
  const context = await operationsContext(projectId, "tasks", true)
  const operation = await loadProjectOperation(context.db, projectId, todoId)
  if (!operation || !isProjectTodoRecordType(operation.sourceRecordType)) {
    throw new Error("To-do not found")
  }
  if (operation.updatedAt !== expectedUpdatedAt) {
    throw new Error("This to-do changed after you opened it. Refresh and review the latest version.")
  }
  return { ...context, operation }
}

const CHANGED_WHILE_SAVING = "This to-do changed while you were saving. Refresh and review the latest version."

export async function updateProjectTodo(
  projectId: string,
  todoId: string,
  input: UpdateProjectTodoInput,
): Promise<ProjectTodoActionResult> {
  try {
    const { db, user, organizationId, operation } = await findEditableProjectTodo(
      projectId,
      todoId,
      input.expectedUpdatedAt,
    )
    if (!isProjectTodoStatus(input.status)) {
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
    const [updated] = await updateOperationsReturning(db, sameVersion(projectId, todoId, input.expectedUpdatedAt), {
      sourceRecordType,
      title,
      description: cleanText(input.description),
      status: input.status,
      priority: cleanText(input.priority) ?? "normal",
      assigneeType: assigneeTypeForTask(sourceRecordType),
      assigneeName,
      companyName,
      startDate,
      dueDate,
      ...(input.costCode !== undefined ? { costCode: cleanText(input.costCode) } : {}),
      updatedAt,
    })
    if (!updated) return { success: false, error: CHANGED_WHILE_SAVING }
    if (input.status !== operation.status) {
      await recordTodoEvent(db, {
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
      })
    }

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

export async function setProjectTodoStatus(
  projectId: string,
  todoId: string,
  status: ProjectTodoStatus,
  expectedUpdatedAt: string,
): Promise<ProjectTodoActionResult> {
  try {
    if (!isProjectTodoStatus(status)) {
      return { success: false, error: "Choose a valid to-do status." }
    }
    const { db, user, organizationId, operation } = await findEditableProjectTodo(projectId, todoId, expectedUpdatedAt)
    const updatedAt = new Date().toISOString()
    const [updated] = await updateOperationsReturning(db, sameVersion(projectId, todoId, expectedUpdatedAt), {
      status,
      updatedAt,
    })
    if (!updated) return { success: false, error: CHANGED_WHILE_SAVING }

    if (status !== operation.status) {
      await recordTodoEvent(db, {
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
      })
    }

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
    const { db } = await findEditableProjectTodo(projectId, todoId, expectedUpdatedAt)
    const updatedAt = new Date().toISOString()
    const [updated] = await updateOperationsReturning(db, sameVersion(projectId, todoId, expectedUpdatedAt), {
      status: "archived",
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
  return setProjectTodoStatus(projectId, todoId, "open", expectedUpdatedAt)
}

export async function deleteProjectTodo(
  projectId: string,
  todoId: string,
  expectedUpdatedAt: string,
): Promise<ProjectTodoActionResult> {
  try {
    const { db, operation } = await findEditableProjectTodo(projectId, todoId, expectedUpdatedAt)
    if (!isArchivedProjectTodoStatus(operation.status)) {
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
