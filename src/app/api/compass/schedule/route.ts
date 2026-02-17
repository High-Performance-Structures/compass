import { getCloudflareContext } from "@opennextjs/cloudflare"
import { getDb } from "@/db"
import { validateAgentAuth } from "@/lib/agent/api-auth"
import { projects, scheduleTasks, taskDependencies, workdayExceptions } from "@/db/schema"
import { eq, asc, and } from "drizzle-orm"
import { calculateEndDate } from "@/lib/schedule/business-days"
import { findCriticalPath } from "@/lib/schedule/critical-path"
import { wouldCreateCycle } from "@/lib/schedule/dependency-validation"
import { propagateDates } from "@/lib/schedule/propagate-dates"
import { revalidatePath } from "next/cache"
import type {
  TaskStatus,
  DependencyType,
  ExceptionCategory,
  ExceptionRecurrence,
  WorkdayExceptionData,
} from "@/lib/schedule/types"

type ScheduleAction =
  | "getSchedule"
  | "createTask"
  | "updateTask"
  | "deleteTask"
  | "createDependency"
  | "deleteDependency"
  | "addException"
  | "removeException"

async function fetchProjectExceptions(
  db: ReturnType<typeof getDb>,
  projectId: string,
): Promise<WorkdayExceptionData[]> {
  const rows = await db
    .select()
    .from(workdayExceptions)
    .where(eq(workdayExceptions.projectId, projectId))
  return rows.map((r) => ({
    ...r,
    category: r.category as ExceptionCategory,
    recurrence: r.recurrence as ExceptionRecurrence,
  }))
}

async function fetchProjectDeps(
  db: ReturnType<typeof getDb>,
  projectId: string,
) {
  const tasks = await db
    .select()
    .from(scheduleTasks)
    .where(eq(scheduleTasks.projectId, projectId))
  const allDeps = await db.select().from(taskDependencies)
  const taskIdSet = new Set(tasks.map((t) => t.id))
  const deps = allDeps.filter(
    (d) =>
      taskIdSet.has(d.predecessorId) && taskIdSet.has(d.successorId),
  )
  return {
    tasks: tasks.map((t) => ({
      ...t,
      status: t.status as TaskStatus,
    })),
    deps: deps.map((d) => ({
      ...d,
      type: d.type as DependencyType,
    })),
  }
}

async function recalcCriticalPathDirect(
  db: ReturnType<typeof getDb>,
  projectId: string,
): Promise<void> {
  const tasks = await db
    .select()
    .from(scheduleTasks)
    .where(eq(scheduleTasks.projectId, projectId))

  const allDeps = await db.select().from(taskDependencies)
  const taskIdSet = new Set(tasks.map((t) => t.id))
  const projectDeps = allDeps.filter(
    (d) =>
      taskIdSet.has(d.predecessorId) && taskIdSet.has(d.successorId),
  )

  const criticalSet = findCriticalPath(
    tasks.map((t) => ({
      ...t,
      status: t.status as TaskStatus,
    })),
    projectDeps.map((d) => ({
      ...d,
      type: d.type as DependencyType,
    })),
  )

  for (const task of tasks) {
    const isCritical = criticalSet.has(task.id)
    if (task.isCriticalPath !== isCritical) {
      await db
        .update(scheduleTasks)
        .set({ isCriticalPath: isCritical })
        .where(eq(scheduleTasks.id, task.id))
    }
  }
}

export async function POST(req: Request): Promise<Response> {
  const { env } = await getCloudflareContext()
  const envRecord = env as unknown as Record<string, string>

  const auth = await validateAgentAuth(req, envRecord)
  if (!auth.valid) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    })
  }

  const db = getDb(env.DB)

  let body: { action: ScheduleAction; [key: string]: unknown }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  try {
    switch (body.action) {
      case "getSchedule": {
        const projectId = body.projectId as string
        if (!projectId) {
          return new Response(
            JSON.stringify({ error: "projectId required" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        const [project] = await db
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              eq(projects.id, projectId),
              eq(projects.organizationId, auth.orgId)
            )
          )
          .limit(1)

        if (!project) {
          return new Response(
            JSON.stringify({ error: "Project not found" }),
            {
              status: 404,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        const { tasks: typedTasks, deps: typedDeps } =
          await fetchProjectDeps(db, projectId)
        const exceptions = await fetchProjectExceptions(db, projectId)

        const total = typedTasks.length
        const completed = typedTasks.filter(
          (t) => t.status === "COMPLETE",
        ).length
        const inProgress = typedTasks.filter(
          (t) => t.status === "IN_PROGRESS",
        ).length
        const blocked = typedTasks.filter(
          (t) => t.status === "BLOCKED",
        ).length
        const overallPercent =
          total > 0
            ? Math.round(
                typedTasks.reduce(
                  (sum, t) => sum + t.percentComplete,
                  0,
                ) / total,
              )
            : 0
        const criticalPath = typedTasks
          .filter((t) => t.isCriticalPath)
          .map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            startDate: t.startDate,
            endDate: t.endDateCalculated,
          }))

        return new Response(
          JSON.stringify({
            tasks: typedTasks,
            dependencies: typedDeps,
            exceptions,
            summary: {
              total,
              completed,
              inProgress,
              blocked,
              pending: total - completed - inProgress - blocked,
              overallPercent,
              criticalPath,
            },
          }),
          {
            headers: { "Content-Type": "application/json" },
          }
        )
      }

      case "createTask": {
        if (auth.isDemoUser) {
          return new Response(
            JSON.stringify({ error: "DEMO_READ_ONLY" }),
            {
              status: 403,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        const projectId = body.projectId as string
        const title = body.title as string
        const startDate = body.startDate as string
        const workdays = body.workdays as number
        const phase = body.phase as string
        const isMilestone = (body.isMilestone as boolean) ?? false
        const percentComplete = (body.percentComplete as number) ?? 0
        const assignedTo = (body.assignedTo as string | undefined) ?? null

        if (!projectId || !title || !startDate || workdays === undefined || !phase) {
          return new Response(
            JSON.stringify({ error: "Missing required fields" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        const [project] = await db
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              eq(projects.id, projectId),
              eq(projects.organizationId, auth.orgId)
            )
          )
          .limit(1)

        if (!project) {
          return new Response(
            JSON.stringify({ error: "Project not found" }),
            {
              status: 404,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        const exceptions = await fetchProjectExceptions(db, projectId)
        const endDate = calculateEndDate(startDate, workdays, exceptions)
        const now = new Date().toISOString()

        const existing = await db
          .select({ sortOrder: scheduleTasks.sortOrder })
          .from(scheduleTasks)
          .where(eq(scheduleTasks.projectId, projectId))
          .orderBy(asc(scheduleTasks.sortOrder))

        const nextOrder =
          existing.length > 0
            ? existing[existing.length - 1].sortOrder + 1
            : 0

        const id = crypto.randomUUID()
        await db.insert(scheduleTasks).values({
          id,
          projectId,
          title,
          startDate,
          workdays,
          endDateCalculated: endDate,
          phase,
          status: "PENDING",
          isCriticalPath: false,
          isMilestone,
          percentComplete,
          assignedTo,
          sortOrder: nextOrder,
          createdAt: now,
          updatedAt: now,
        })

        await recalcCriticalPathDirect(db, projectId)
        revalidatePath(`/dashboard/projects/${projectId}/schedule`)

        return new Response(
          JSON.stringify({
            success: true,
            message: `Task "${title}" created`,
          }),
          {
            headers: { "Content-Type": "application/json" },
          }
        )
      }

      case "updateTask": {
        if (auth.isDemoUser) {
          return new Response(
            JSON.stringify({ error: "DEMO_READ_ONLY" }),
            {
              status: 403,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        const taskId = body.taskId as string
        if (!taskId) {
          return new Response(
            JSON.stringify({ error: "taskId required" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        const [task] = await db
          .select()
          .from(scheduleTasks)
          .where(eq(scheduleTasks.id, taskId))
          .limit(1)

        if (!task) {
          return new Response(
            JSON.stringify({ error: "Task not found" }),
            {
              status: 404,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        const { action: _action, taskId: _taskId, status, ...fields } = body
        const hasFields = Object.keys(fields).length > 0

        if (hasFields) {
          const exceptions = await fetchProjectExceptions(db, task.projectId)

          const startDate = (fields.startDate as string) ?? task.startDate
          const workdays = (fields.workdays as number) ?? task.workdays
          const endDate = calculateEndDate(startDate, workdays, exceptions)

          await db
            .update(scheduleTasks)
            .set({
              ...(fields.title ? { title: fields.title as string } : {}),
              startDate,
              workdays,
              endDateCalculated: endDate,
              ...(fields.phase ? { phase: fields.phase as string } : {}),
              ...(fields.isMilestone !== undefined
                ? { isMilestone: fields.isMilestone as boolean }
                : {}),
              ...(fields.percentComplete !== undefined
                ? { percentComplete: fields.percentComplete as number }
                : {}),
              ...(fields.assignedTo !== undefined
                ? { assignedTo: fields.assignedTo as string | null }
                : {}),
              updatedAt: new Date().toISOString(),
            })
            .where(eq(scheduleTasks.id, taskId))

          // propagate date changes
          const allTasks = await db
            .select()
            .from(scheduleTasks)
            .where(eq(scheduleTasks.projectId, task.projectId))
          const allDeps = await db.select().from(taskDependencies)
          const taskIdSet = new Set(allTasks.map((t) => t.id))
          const projectDeps = allDeps
            .filter(
              (d) =>
                taskIdSet.has(d.predecessorId) &&
                taskIdSet.has(d.successorId),
            )
            .map((d) => ({
              ...d,
              type: d.type as DependencyType,
            }))

          const updatedTask = {
            ...task,
            status: task.status as TaskStatus,
            startDate,
            workdays,
            endDateCalculated: endDate,
          }
          const typedAll = allTasks.map((t) =>
            t.id === taskId
              ? updatedTask
              : { ...t, status: t.status as TaskStatus },
          )
          const { updatedTasks } = propagateDates(
            taskId,
            typedAll,
            projectDeps,
            exceptions,
          )

          for (const [id, dates] of updatedTasks) {
            await db
              .update(scheduleTasks)
              .set({
                startDate: dates.startDate,
                endDateCalculated: dates.endDateCalculated,
                updatedAt: new Date().toISOString(),
              })
              .where(eq(scheduleTasks.id, id))
          }
        }

        if (status) {
          await db
            .update(scheduleTasks)
            .set({
              status: status as TaskStatus,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(scheduleTasks.id, taskId))
        }

        if (!hasFields && !status) {
          return new Response(
            JSON.stringify({ error: "No fields provided to update" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        await recalcCriticalPathDirect(db, task.projectId)
        revalidatePath(`/dashboard/projects/${task.projectId}/schedule`)

        return new Response(
          JSON.stringify({
            success: true,
            message: "Task updated",
          }),
          {
            headers: { "Content-Type": "application/json" },
          }
        )
      }

      case "deleteTask": {
        if (auth.isDemoUser) {
          return new Response(
            JSON.stringify({ error: "DEMO_READ_ONLY" }),
            {
              status: 403,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        const taskId = body.taskId as string
        if (!taskId) {
          return new Response(
            JSON.stringify({ error: "taskId required" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        const [task] = await db
          .select()
          .from(scheduleTasks)
          .where(eq(scheduleTasks.id, taskId))
          .limit(1)

        if (!task) {
          return new Response(
            JSON.stringify({ error: "Task not found" }),
            {
              status: 404,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        await db
          .delete(scheduleTasks)
          .where(eq(scheduleTasks.id, taskId))
        await recalcCriticalPathDirect(db, task.projectId)
        revalidatePath(`/dashboard/projects/${task.projectId}/schedule`)

        return new Response(
          JSON.stringify({
            success: true,
            message: "Task deleted",
          }),
          {
            headers: { "Content-Type": "application/json" },
          }
        )
      }

      case "createDependency": {
        if (auth.isDemoUser) {
          return new Response(
            JSON.stringify({ error: "DEMO_READ_ONLY" }),
            {
              status: 403,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        const projectId = body.projectId as string
        const predecessorId = body.predecessorId as string
        const successorId = body.successorId as string
        const type = body.type as DependencyType
        const lagDays = (body.lagDays as number) ?? 0

        if (!projectId || !predecessorId || !successorId || !type) {
          return new Response(
            JSON.stringify({ error: "Missing required fields" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        const { deps: existingDeps } = await fetchProjectDeps(db, projectId)

        if (
          wouldCreateCycle(existingDeps, predecessorId, successorId)
        ) {
          return new Response(
            JSON.stringify({
              error: "This dependency would create a cycle",
            }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        const depId = crypto.randomUUID()
        await db.insert(taskDependencies).values({
          id: depId,
          predecessorId,
          successorId,
          type,
          lagDays,
        })

        const exceptions = await fetchProjectExceptions(db, projectId)
        const { tasks: typedTasks } = await fetchProjectDeps(db, projectId)

        const updatedDeps = [
          ...existingDeps,
          {
            id: depId,
            predecessorId,
            successorId,
            type,
            lagDays,
          },
        ]
        const { updatedTasks } = propagateDates(
          predecessorId,
          typedTasks,
          updatedDeps,
          exceptions,
        )

        for (const [id, dates] of updatedTasks) {
          await db
            .update(scheduleTasks)
            .set({
              startDate: dates.startDate,
              endDateCalculated: dates.endDateCalculated,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(scheduleTasks.id, id))
        }

        await recalcCriticalPathDirect(db, projectId)
        revalidatePath(`/dashboard/projects/${projectId}/schedule`)

        return new Response(
          JSON.stringify({
            success: true,
            message: "Dependency created",
          }),
          {
            headers: { "Content-Type": "application/json" },
          }
        )
      }

      case "deleteDependency": {
        if (auth.isDemoUser) {
          return new Response(
            JSON.stringify({ error: "DEMO_READ_ONLY" }),
            {
              status: 403,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        const dependencyId = body.dependencyId as string
        const projectId = body.projectId as string

        if (!dependencyId || !projectId) {
          return new Response(
            JSON.stringify({ error: "dependencyId and projectId required" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        await db
          .delete(taskDependencies)
          .where(eq(taskDependencies.id, dependencyId))
        await recalcCriticalPathDirect(db, projectId)
        revalidatePath(`/dashboard/projects/${projectId}/schedule`)

        return new Response(
          JSON.stringify({
            success: true,
            message: "Dependency removed",
          }),
          {
            headers: { "Content-Type": "application/json" },
          }
        )
      }

      default:
        return new Response(
          JSON.stringify({ error: "Unknown action" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        )
    }
  } catch (error) {
    console.error("Schedule endpoint error:", error)
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    )
  }
}
