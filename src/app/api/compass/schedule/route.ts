import { getCloudflareContext } from "@/lib/db"
import { getDb } from "@/db"
import { validateAgentAuth } from "@/lib/agent/api-auth"
import { revalidatePath } from "next/cache"
import {
  isOrganizationProject,
  findTask,
  loadProjectExceptions,
  loadProjectScheduleRows,
  nextProjectSortOrder,
} from "@/lib/domain/schedule/queries"
import {
  canViewWorkingSchedule,
} from "@/lib/domain/schedule/access"
import {
  dependencyData,
  isDependencyType,
  isTaskStatus,
  propagateFrom,
  scheduleSummary,
  taskWithProgress,
  taskWithStatus,
  validateDependency,
} from "@/lib/domain/schedule/rules"
import {
  deleteDependency,
  deleteTask,
  insertDependency,
  insertTask,
  recalcCriticalPath,
  updateTask,
  updateTaskDates,
} from "@/lib/domain/schedule/store"
import { calculateEndDate } from "@/lib/schedule/business-days"
import { normalizeScheduleProgress } from "@/lib/schedule/progress"
import type { TaskStatus } from "@/lib/schedule/types"
import { field } from "@/lib/shared/guards"
import type { Db } from "@/lib/server/action-context"

/*
 * The agent's schedule API. It authenticates with the agent token, then
 * calls the same schedule domain module (store, queries, rules) as the
 * server actions. It keeps its own narrower behavior: it does not shift
 * linked to-dos or reset assignee responses when dates move.
 */

type ScheduleAction =
  | "getSchedule"
  | "createTask"
  | "updateTask"
  | "deleteTask"
  | "createDependency"
  | "deleteDependency"
  | "addException"
  | "removeException"

type Body = { action: ScheduleAction; [key: string]: unknown }

function json(body: unknown, status?: number): Response {
  return new Response(JSON.stringify(body), {
    ...(status === undefined ? {} : { status }),
    headers: { "Content-Type": "application/json" },
  })
}

const DEMO_READ_ONLY = (): Response => json({ error: "DEMO_READ_ONLY" }, 403)

function revalidateSchedule(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}/schedule`)
}

/** A project's tasks (as the schedule shows them) and dependencies. */
async function projectSchedule(db: Db, projectId: string) {
  const { tasks, dependencies } = await loadProjectScheduleRows(db, projectId)
  return { tasks: tasks.map(taskWithProgress), deps: dependencies.map(dependencyData) }
}

async function getSchedule(db: Db, orgId: string, body: Body): Promise<Response> {
  const projectId = body.projectId as string
  if (!projectId) return json({ error: "projectId required" }, 400)
  if (!(await isOrganizationProject(db, orgId, projectId))) {
    return json({ error: "Project not found" }, 404)
  }

  const { tasks, deps } = await projectSchedule(db, projectId)
  const exceptions = await loadProjectExceptions(db, projectId)
  return json({ tasks, dependencies: deps, exceptions, summary: scheduleSummary(tasks) })
}

async function createTask(db: Db, orgId: string, body: Body): Promise<Response> {
  const projectId = body.projectId as string
  const title = body.title as string
  const startDate = body.startDate as string
  const workdays = body.workdays as number
  const phase = body.phase as string
  const requestedStatus = isTaskStatus(body.status) ? body.status : "PENDING"
  const isMilestone = (body.isMilestone as boolean) ?? false
  const percentComplete = (body.percentComplete as number) ?? 0
  const assignedTo = (body.assignedTo as string | undefined) ?? null

  if (!projectId || !title || !startDate || workdays === undefined || !phase) {
    return json({ error: "Missing required fields" }, 400)
  }
  if (!(await isOrganizationProject(db, orgId, projectId))) {
    return json({ error: "Project not found" }, 404)
  }

  const exceptions = await loadProjectExceptions(db, projectId)
  const endDate = calculateEndDate(startDate, workdays, exceptions)
  const now = new Date().toISOString()
  const progress = normalizeScheduleProgress(requestedStatus, percentComplete)
  await insertTask(db, {
    id: crypto.randomUUID(),
    projectId,
    title,
    startDate,
    workdays,
    endDateCalculated: endDate,
    phase,
    status: progress.status,
    isCriticalPath: false,
    isMilestone,
    percentComplete: progress.percentComplete,
    assignedTo,
    sortOrder: await nextProjectSortOrder(db, projectId),
    createdAt: now,
    updatedAt: now,
  })

  await recalcCriticalPath(db, projectId)
  revalidateSchedule(projectId)
  return json({ success: true, message: `Task "${title}" created` })
}

/** The project of an organization's task, or null when it is not theirs. */
async function organizationTask(db: Db, orgId: string, taskId: string) {
  const task = await findTask(db, taskId)
  if (!task || !(await isOrganizationProject(db, orgId, task.projectId))) return null
  return task
}

async function updateTaskAction(db: Db, orgId: string, body: Body): Promise<Response> {
  const taskId = body.taskId as string
  if (!taskId) return json({ error: "taskId required" }, 400)
  const task = await organizationTask(db, orgId, taskId)
  if (!task) return json({ error: "Task not found" }, 404)

  const status = body.status
  const fields: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) {
    if (key !== "action" && key !== "taskId" && key !== "status") {
      fields[key] = value
    }
  }
  const hasFields = Object.keys(fields).length > 0
  if (status !== undefined && !isTaskStatus(status)) {
    return json({ error: "Invalid status" }, 400)
  }
  const requestedStatus = isTaskStatus(status) ? status : (task.status as TaskStatus)
  const requestedPercent =
    fields.percentComplete !== undefined ? (fields.percentComplete as number) : task.percentComplete
  const progress = normalizeScheduleProgress(requestedStatus, requestedPercent)

  if (hasFields) {
    const exceptions = await loadProjectExceptions(db, task.projectId)
    const startDate = (fields.startDate as string) ?? task.startDate
    const workdays = (fields.workdays as number) ?? task.workdays
    const endDate = calculateEndDate(startDate, workdays, exceptions)

    await updateTask(db, taskId, {
      ...(fields.title ? { title: fields.title as string } : {}),
      startDate,
      workdays,
      endDateCalculated: endDate,
      ...(fields.phase ? { phase: fields.phase as string } : {}),
      status: progress.status,
      ...(fields.isMilestone !== undefined ? { isMilestone: fields.isMilestone as boolean } : {}),
      percentComplete: progress.percentComplete,
      ...(fields.assignedTo !== undefined ? { assignedTo: fields.assignedTo as string | null } : {}),
      updatedAt: new Date().toISOString(),
    })

    // propagate date changes
    const { tasks, dependencies } = await loadProjectScheduleRows(db, task.projectId)
    const updatedTask = {
      ...task,
      status: progress.status,
      percentComplete: progress.percentComplete,
      startDate,
      workdays,
      endDateCalculated: endDate,
    }
    const updates = propagateFrom(
      taskId,
      tasks.map((row) => (row.id === taskId ? updatedTask : taskWithStatus(row))),
      dependencies.map(dependencyData),
      exceptions
    )
    await updateTaskDates(db, updates, new Date().toISOString())
  }

  if (status) {
    await updateTask(db, taskId, {
      status: progress.status,
      percentComplete: progress.percentComplete,
      updatedAt: new Date().toISOString(),
    })
  }

  if (!hasFields && !status) {
    return json({ error: "No fields provided to update" }, 400)
  }

  await recalcCriticalPath(db, task.projectId)
  revalidateSchedule(task.projectId)
  return json({ success: true, message: "Task updated" })
}

async function deleteTaskAction(db: Db, orgId: string, body: Body): Promise<Response> {
  const taskId = body.taskId as string
  if (!taskId) return json({ error: "taskId required" }, 400)
  const task = await organizationTask(db, orgId, taskId)
  if (!task) return json({ error: "Task not found" }, 404)

  await deleteTask(db, taskId)
  await recalcCriticalPath(db, task.projectId)
  revalidateSchedule(task.projectId)
  return json({ success: true, message: "Task deleted" })
}

async function createDependency(db: Db, orgId: string, body: Body): Promise<Response> {
  const projectId = body.projectId as string
  const predecessorId = body.predecessorId as string
  const successorId = body.successorId as string
  const type = body.type
  const lagDays = (body.lagDays as number) ?? 0

  if (!projectId || !predecessorId || !successorId || !isDependencyType(type)) {
    return json({ error: "Missing required fields" }, 400)
  }
  if (!(await isOrganizationProject(db, orgId, projectId))) {
    return json({ error: "Project not found" }, 404)
  }

  const { tasks: projectTasks, deps: existingDeps } = await projectSchedule(db, projectId)
  const invalid = validateDependency({
    predecessorId,
    successorId,
    projectTaskIds: new Set(projectTasks.map((task) => task.id)),
    dependencies: existingDeps,
  })
  if (invalid) return json({ error: invalid }, 400)

  const dependency = { id: crypto.randomUUID(), predecessorId, successorId, type, lagDays }
  await insertDependency(db, dependency)

  const exceptions = await loadProjectExceptions(db, projectId)
  const { tasks } = await projectSchedule(db, projectId)
  const updates = propagateFrom(predecessorId, tasks, [...existingDeps, dependency], exceptions)
  await updateTaskDates(db, updates, new Date().toISOString())

  await recalcCriticalPath(db, projectId)
  revalidateSchedule(projectId)
  return json({ success: true, message: "Dependency created" })
}

async function deleteDependencyAction(db: Db, orgId: string, body: Body): Promise<Response> {
  const dependencyId = body.dependencyId as string
  const projectId = body.projectId as string
  if (!dependencyId || !projectId) {
    return json({ error: "dependencyId and projectId required" }, 400)
  }
  if (!(await isOrganizationProject(db, orgId, projectId))) {
    return json({ error: "Project not found" }, 404)
  }

  const { deps } = await projectSchedule(db, projectId)
  if (!deps.some((dependency) => dependency.id === dependencyId)) {
    return json({ error: "Dependency not found for this project" }, 404)
  }

  await deleteDependency(db, dependencyId)
  await recalcCriticalPath(db, projectId)
  revalidateSchedule(projectId)
  return json({ success: true, message: "Dependency removed" })
}

export async function POST(req: Request): Promise<Response> {
  const { env } = await getCloudflareContext()
  const secret = field(env, "AGENT_AUTH_SECRET")
  const auth = await validateAgentAuth(req, typeof secret === "string" ? { AGENT_AUTH_SECRET: secret } : {})
  if (!auth.valid) return json({ error: "Unauthorized" }, 401)
  if (!canViewWorkingSchedule(auth.role)) {
    return Response.json(
      { error: "Working schedule access is available to internal staff only" },
      { status: 403 }
    )
  }

  const db = getDb(env.DB)

  let body: Body
  try {
    body = await req.json()
  } catch {
    return json({ error: "Invalid JSON body" }, 400)
  }

  try {
    switch (body.action) {
      case "getSchedule":
        return await getSchedule(db, auth.orgId, body)
      case "createTask":
        return auth.isDemoUser ? DEMO_READ_ONLY() : await createTask(db, auth.orgId, body)
      case "updateTask":
        return auth.isDemoUser ? DEMO_READ_ONLY() : await updateTaskAction(db, auth.orgId, body)
      case "deleteTask":
        return auth.isDemoUser ? DEMO_READ_ONLY() : await deleteTaskAction(db, auth.orgId, body)
      case "createDependency":
        return auth.isDemoUser ? DEMO_READ_ONLY() : await createDependency(db, auth.orgId, body)
      case "deleteDependency":
        return auth.isDemoUser ? DEMO_READ_ONLY() : await deleteDependencyAction(db, auth.orgId, body)
      default:
        return json({ error: "Unknown action" }, 400)
    }
  } catch (error) {
    console.error("Schedule endpoint error:", error)
    return json({ error: error instanceof Error ? error.message : "Internal error" }, 500)
  }
}
