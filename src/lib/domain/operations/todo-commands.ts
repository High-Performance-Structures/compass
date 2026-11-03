import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { dailyLogs } from "@/db/schema"
import { errorMessage } from "@/lib/action-result"
import { operationsContext } from "@/lib/domain/operations/access"
import { countProjectOperations, loadProjectSageNumbers } from "@/lib/domain/operations/queries"
import {
  assigneeTypeForTask,
  normalizeTaskRecordType,
  projectTaskNumberFor,
  requireText,
} from "@/lib/domain/operations/rules"
import { insertOperations, recordTodoEvent } from "@/lib/domain/operations/store"
import type { CreateProjectTaskInput, ProjectOperationActionResult } from "@/lib/domain/operations/types"
import { notifyProjectAssignment } from "@/lib/notifications/events"
import { PROJECT_TODO_RECORD_TYPES } from "@/lib/project-todos"
import { cleanText } from "@/lib/shared/guards"

/*
 * To-do commands shared by the to-do actions and the workflows that create
 * to-dos (estimate pricing, site weather). Access is operations access with
 * the "tasks" permission, as on the To-dos page.
 */

export function revalidateProjectTodoPaths(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}`)
  revalidatePath(`/dashboard/projects/${projectId}/todos`)
  revalidatePath(`/dashboard/projects/${projectId}/daily-logs`)
  revalidatePath(`/dashboard/projects/${projectId}/schedule`)
  revalidatePath("/dashboard")
  revalidatePath("/dashboard/schedule")
}

/**
 * Creates a project to-do with the To-dos page's access check, numbering,
 * history event and assignment notification.
 */
export async function createProjectTaskCommand(
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
