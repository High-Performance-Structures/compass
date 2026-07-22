"use server";

import { getCloudflareContext } from "@/lib/db";
import { getDb } from "@/db";
import {
  buildertrendSourceRecords,
  scheduleTasks,
  taskDependencies,
  workdayExceptions,
  projects,
  projectMembers,
} from "@/db/schema";
import { eq, asc, and, desc, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { calculateEndDate } from "@/lib/schedule/business-days";
import { findCriticalPath } from "@/lib/schedule/critical-path";
import { wouldCreateCycle } from "@/lib/schedule/dependency-validation";
import {
  enforceDependencyDatesFrom,
  propagateDates,
} from "@/lib/schedule/propagate-dates";
import { requireAuth } from "@/lib/auth";
import { requireOrg } from "@/lib/org-scope";
import { isDemoUser } from "@/lib/demo";
import { assertProjectAccess } from "@/lib/project-access";
import { canUseOrganizationProjectScopeRole } from "@/lib/user-roles";
import { normalizeWorkdayExceptionType } from "@/lib/schedule/types";
import {
  grantScheduleAssigneeProjectAccess,
  type ScheduleAssigneeReference,
} from "@/app/actions/schedule-assignees";
import type {
  TaskStatus,
  DependencyType,
  ExceptionCategory,
  ExceptionRecurrence,
  ScheduleData,
  ScheduleTaskData,
  TaskDependencyData,
  WorkdayExceptionData,
} from "@/lib/schedule/types";

export type ProjectScheduleArchiveItem = {
  readonly id: string;
  readonly title: string;
  readonly recordDate: string | null;
  readonly recordStatus: string | null;
  readonly buildertrendUrl: string | null;
  readonly sourceRecordType: string;
};

export type ScheduleProjectOption = {
  readonly id: string;
  readonly name: string;
  readonly projectNumber: string | null;
  readonly clientName: string | null;
  readonly googleDriveFolderId: string | null;
  readonly status: string;
  readonly createdAt: string;
};

export async function getScheduleProjectOptions(): Promise<
  readonly ScheduleProjectOption[]
> {
  const user = await requireAuth();
  const { env } = await getCloudflareContext();
  const db = getDb(env.DB);

  if (
    user.organizationId &&
    user.organizationType === "internal" &&
    canUseOrganizationProjectScopeRole(user.role)
  ) {
    return db
      .select({
        id: projects.id,
        name: projects.name,
        projectNumber: projects.projectNumber,
        clientName: projects.clientName,
        googleDriveFolderId: projects.googleDriveFolderId,
        status: projects.status,
        createdAt: projects.createdAt,
      })
      .from(projects)
      .where(eq(projects.organizationId, user.organizationId))
      .orderBy(asc(projects.projectNumber), asc(projects.name));
  }

  return db
    .select({
      id: projects.id,
      name: projects.name,
      projectNumber: projects.projectNumber,
      clientName: projects.clientName,
      googleDriveFolderId: projects.googleDriveFolderId,
      status: projects.status,
      createdAt: projects.createdAt,
    })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(eq(projectMembers.userId, user.id))
    .orderBy(asc(projects.projectNumber), asc(projects.name));
}

export async function getProjectScheduleArchive(
  projectId: string,
): Promise<readonly ProjectScheduleArchiveItem[]> {
  const user = await requireAuth();
  const { env } = await getCloudflareContext();
  const db = getDb(env.DB);
  await assertProjectAccess(db, user, projectId);

  return db
    .select({
      id: buildertrendSourceRecords.id,
      title: buildertrendSourceRecords.title,
      recordDate: buildertrendSourceRecords.recordDate,
      recordStatus: buildertrendSourceRecords.recordStatus,
      buildertrendUrl: buildertrendSourceRecords.buildertrendUrl,
      sourceRecordType: buildertrendSourceRecords.sourceRecordType,
    })
    .from(buildertrendSourceRecords)
    .where(
      and(
        eq(buildertrendSourceRecords.projectId, projectId),
        inArray(buildertrendSourceRecords.sourceRecordType, [
          "schedule_item",
          "schedule_summary",
        ]),
      ),
    )
    .orderBy(
      desc(buildertrendSourceRecords.recordDate),
      buildertrendSourceRecords.title,
    );
}

async function fetchExceptions(
  db: ReturnType<typeof getDb>,
  projectId: string,
): Promise<WorkdayExceptionData[]> {
  const rows = await db
    .select()
    .from(workdayExceptions)
    .where(eq(workdayExceptions.projectId, projectId));

  return rows.map((r) => ({
    ...r,
    type: normalizeWorkdayExceptionType(r.type),
    category: r.category as ExceptionCategory,
    recurrence: r.recurrence as ExceptionRecurrence,
  }));
}

export async function getSchedule(projectId: string): Promise<ScheduleData> {
  const user = await requireAuth();

  const { env } = await getCloudflareContext();
  const db = getDb(env.DB);

  await assertProjectAccess(db, user, projectId);

  return fetchScheduleData(db, projectId);
}

async function fetchScheduleData(
  db: ReturnType<typeof getDb>,
  projectId: string,
): Promise<ScheduleData> {
  const tasks = await db
    .select()
    .from(scheduleTasks)
    .where(eq(scheduleTasks.projectId, projectId))
    .orderBy(asc(scheduleTasks.sortOrder));

  const taskIds = tasks.map((task) => task.id);
  const deps: TaskDependencyData[] = [];
  const dependencyBatchSize = 80;
  for (let index = 0; index < taskIds.length; index += dependencyBatchSize) {
    const predecessorIds = taskIds.slice(index, index + dependencyBatchSize);
    const batch = await db
      .select()
      .from(taskDependencies)
      .where(inArray(taskDependencies.predecessorId, predecessorIds));
    deps.push(
      ...batch.map((dependency) => ({
        ...dependency,
        type: dependency.type as DependencyType,
      })),
    );
  }
  const exceptions = await fetchExceptions(db, projectId);

  const taskIdSet = new Set(taskIds);
  const projectDeps = deps.filter(
    (dependency) => taskIdSet.has(dependency.successorId),
  );

  return {
    tasks: tasks.map((t) => ({
      ...t,
      status: t.status as TaskStatus,
      phase: t.phase,
    })),
    dependencies: projectDeps,
    exceptions,
  };
}

async function persistDateUpdates(
  database: D1Database,
  updates: ReadonlyMap<
    string,
    { readonly startDate: string; readonly endDateCalculated: string }
  >,
): Promise<void> {
  if (updates.size === 0) return;
  const updatedAt = new Date().toISOString();
  await executePreparedInBatches(
    database,
    Array.from(updates, ([id, dates]) =>
      database
        .prepare(
          "UPDATE schedule_tasks SET start_date = ?, end_date_calculated = ?, updated_at = ? WHERE id = ?",
        )
        .bind(dates.startDate, dates.endDateCalculated, updatedAt, id),
    ),
  );
}

const D1_BATCH_SIZE = 80;

async function executePreparedInBatches(
  database: D1Database,
  statements: readonly ReturnType<D1Database["prepare"]>[],
): Promise<void> {
  for (let index = 0; index < statements.length; index += D1_BATCH_SIZE) {
    await database.batch(statements.slice(index, index + D1_BATCH_SIZE));
  }
}

export type ScheduleTaskPredecessorInput = {
  readonly predecessorId: string;
  readonly type: DependencyType;
  readonly lagDays: number;
};

export type SaveScheduleTaskInput = {
  readonly taskId: string | null;
  readonly title: string;
  readonly startDate: string;
  readonly workdays: number;
  readonly phase: string;
  readonly status: TaskStatus;
  readonly isMilestone: boolean;
  readonly percentComplete: number;
  readonly assignedTo: string | null;
  readonly assigneeReference: ScheduleAssigneeReference | null;
  readonly predecessors: readonly ScheduleTaskPredecessorInput[];
};

export async function saveScheduleTask(
  projectId: string,
  input: SaveScheduleTaskInput,
): Promise<
  | { readonly success: true; readonly taskId: string }
  | { readonly success: false; readonly error: string }
> {
  try {
    const user = await requireAuth();
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" };
    }

    const { env } = await getCloudflareContext();
    const db = getDb(env.DB);
    await assertProjectAccess(db, user, projectId);

    if (input.assigneeReference) {
      const accessResult = await grantScheduleAssigneeProjectAccess({
        db,
        projectId,
        organizationId: requireOrg(user),
        reference: input.assigneeReference,
      });
      if (!accessResult.success) return accessResult;
    }

    const schedule = await fetchScheduleData(db, projectId);
    const now = new Date().toISOString();
    const taskId = input.taskId ?? crypto.randomUUID();
    const currentTask = schedule.tasks.find((task) => task.id === taskId);

    if (input.taskId && !currentTask) {
      return { success: false, error: "Schedule item not found" };
    }
    if (!input.title.trim()) {
      return { success: false, error: "A schedule item title is required" };
    }
    if (input.workdays < 1) {
      return { success: false, error: "Duration must be at least one workday" };
    }

    const projectTaskIds = new Set(schedule.tasks.map((task) => task.id));
    const predecessorIds = new Set<string>();
    for (const predecessor of input.predecessors) {
      if (!projectTaskIds.has(predecessor.predecessorId)) {
        return {
          success: false,
          error: "A predecessor does not belong to this project",
        };
      }
      if (predecessor.predecessorId === taskId) {
        return { success: false, error: "An item cannot precede itself" };
      }
      if (predecessorIds.has(predecessor.predecessorId)) {
        return { success: false, error: "Each predecessor can only be added once" };
      }
      predecessorIds.add(predecessor.predecessorId);
    }

    const dependenciesWithoutIncoming = schedule.dependencies.filter(
      (dependency) => dependency.successorId !== taskId,
    );
    const nextDependencies: TaskDependencyData[] = [...dependenciesWithoutIncoming];
    const dependencyRows = input.predecessors.map((predecessor) => ({
      id: crypto.randomUUID(),
      predecessorId: predecessor.predecessorId,
      successorId: taskId,
      type: predecessor.type,
      lagDays: Math.trunc(predecessor.lagDays),
    }));

    for (const dependency of dependencyRows) {
      if (
        wouldCreateCycle(
          nextDependencies,
          dependency.predecessorId,
          dependency.successorId,
        )
      ) {
        return {
          success: false,
          error: "These predecessors would create a circular schedule",
        };
      }
      nextDependencies.push(dependency);
    }

    const existingLastTask = schedule.tasks.at(-1);
    const nextSortOrder = existingLastTask ? existingLastTask.sortOrder + 1 : 0;
    const savedTask: ScheduleTaskData = {
      id: taskId,
      projectId,
      title: input.title.trim(),
      startDate: input.startDate,
      workdays: input.workdays,
      endDateCalculated: calculateEndDate(
        input.startDate,
        input.workdays,
        schedule.exceptions,
      ),
      phase: input.phase,
      status: input.status,
      isCriticalPath: currentTask?.isCriticalPath ?? false,
      isMilestone: input.isMilestone,
      percentComplete: input.percentComplete,
      assignedTo: input.assignedTo,
      sortOrder: currentTask?.sortOrder ?? nextSortOrder,
      createdAt: currentTask?.createdAt ?? now,
      updatedAt: now,
    };
    const nextTasks = currentTask
      ? schedule.tasks.map((task) => (task.id === taskId ? savedTask : task))
      : [...schedule.tasks, savedTask];
    const propagation = enforceDependencyDatesFrom(
      taskId,
      nextTasks,
      nextDependencies,
      schedule.exceptions,
      true,
    );
    if (propagation.cycleDetected) {
      return {
        success: false,
        error: "The schedule contains a circular dependency",
      };
    }

    const statements: ReturnType<D1Database["prepare"]>[] = [];
    if (currentTask) {
      statements.push(
        env.DB.prepare(
          "UPDATE schedule_tasks SET title = ?, start_date = ?, workdays = ?, end_date_calculated = ?, phase = ?, status = ?, is_milestone = ?, percent_complete = ?, assigned_to = ?, updated_at = ? WHERE id = ? AND project_id = ?",
        ).bind(
          savedTask.title,
          savedTask.startDate,
          savedTask.workdays,
          savedTask.endDateCalculated,
          savedTask.phase,
          savedTask.status,
          savedTask.isMilestone ? 1 : 0,
          savedTask.percentComplete,
          savedTask.assignedTo,
          now,
          taskId,
          projectId,
        ),
      );
    } else {
      statements.push(
        env.DB.prepare(
          "INSERT INTO schedule_tasks (id, project_id, title, start_date, workdays, end_date_calculated, phase, status, is_critical_path, is_milestone, percent_complete, assigned_to, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(
          savedTask.id,
          savedTask.projectId,
          savedTask.title,
          savedTask.startDate,
          savedTask.workdays,
          savedTask.endDateCalculated,
          savedTask.phase,
          savedTask.status,
          0,
          savedTask.isMilestone ? 1 : 0,
          savedTask.percentComplete,
          savedTask.assignedTo,
          savedTask.sortOrder,
          savedTask.createdAt,
          savedTask.updatedAt,
        ),
      );
    }

    statements.push(
      env.DB.prepare(
        "DELETE FROM task_dependencies WHERE successor_id = ?",
      ).bind(taskId),
    );
    for (const dependency of dependencyRows) {
      statements.push(
        env.DB.prepare(
          "INSERT INTO task_dependencies (id, predecessor_id, successor_id, type, lag_days) VALUES (?, ?, ?, ?, ?)",
        ).bind(
          dependency.id,
          dependency.predecessorId,
          dependency.successorId,
          dependency.type,
          dependency.lagDays,
        ),
      );
    }
    for (const [updatedTaskId, dates] of propagation.updatedTasks) {
      statements.push(
        env.DB.prepare(
          "UPDATE schedule_tasks SET start_date = ?, end_date_calculated = ?, updated_at = ? WHERE id = ?",
        ).bind(
          dates.startDate,
          dates.endDateCalculated,
          now,
          updatedTaskId,
        ),
      );
    }

    await executePreparedInBatches(env.DB, statements);
    await recalcCriticalPath(db, env.DB, projectId);
    revalidatePath(`/dashboard/projects/${projectId}/schedule`);
    return { success: true, taskId };
  } catch (error) {
    console.error("Failed to save schedule item:", error);
    return { success: false, error: "Failed to save schedule item" };
  }
}

export async function createTask(
  projectId: string,
  data: {
    title: string;
    startDate: string;
    workdays: number;
    phase: string;
    isMilestone?: boolean;
    percentComplete?: number;
    assignedTo?: string;
  },
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await requireAuth();
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" };
    }
    const orgId = requireOrg(user);

    const { env } = await getCloudflareContext();
    const db = getDb(env.DB);

    // verify project belongs to user's org
    const [project] = await db
      .select()
      .from(projects)
      .where(
        and(eq(projects.id, projectId), eq(projects.organizationId, orgId)),
      )
      .limit(1);

    if (!project) {
      return { success: false, error: "Project not found or access denied" };
    }

    const exceptions = await fetchExceptions(db, projectId);
    const endDate = calculateEndDate(data.startDate, data.workdays, exceptions);
    const now = new Date().toISOString();

    const existing = await db
      .select({ sortOrder: scheduleTasks.sortOrder })
      .from(scheduleTasks)
      .where(eq(scheduleTasks.projectId, projectId))
      .orderBy(asc(scheduleTasks.sortOrder));

    const nextOrder =
      existing.length > 0 ? existing[existing.length - 1].sortOrder + 1 : 0;

    const id = crypto.randomUUID();
    await db.insert(scheduleTasks).values({
      id,
      projectId,
      title: data.title,
      startDate: data.startDate,
      workdays: data.workdays,
      endDateCalculated: endDate,
      phase: data.phase,
      status: "PENDING",
      isCriticalPath: false,
      isMilestone: data.isMilestone ?? false,
      percentComplete: data.percentComplete ?? 0,
      assignedTo: data.assignedTo ?? null,
      sortOrder: nextOrder,
      createdAt: now,
      updatedAt: now,
    });

    await recalcCriticalPath(db, env.DB, projectId);
    revalidatePath(`/dashboard/projects/${projectId}/schedule`);
    return { success: true };
  } catch (error) {
    console.error("Failed to create task:", error);
    return { success: false, error: "Failed to create task" };
  }
}

export async function updateTask(
  taskId: string,
  data: {
    title?: string;
    startDate?: string;
    workdays?: number;
    phase?: string;
    isMilestone?: boolean;
    percentComplete?: number;
    assignedTo?: string | null;
  },
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await requireAuth();
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" };
    }
    const orgId = requireOrg(user);

    const { env } = await getCloudflareContext();
    const db = getDb(env.DB);

    const [task] = await db
      .select()
      .from(scheduleTasks)
      .where(eq(scheduleTasks.id, taskId))
      .limit(1);

    if (!task) return { success: false, error: "Task not found" };

    // verify project belongs to user's org
    const [project] = await db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.id, task.projectId),
          eq(projects.organizationId, orgId),
        ),
      )
      .limit(1);

    if (!project) {
      return { success: false, error: "Access denied" };
    }

    const exceptions = await fetchExceptions(db, task.projectId);
    const startDate = data.startDate ?? task.startDate;
    const workdays = data.workdays ?? task.workdays;
    const endDate = calculateEndDate(startDate, workdays, exceptions);

    await db
      .update(scheduleTasks)
      .set({
        ...(data.title && { title: data.title }),
        startDate,
        workdays,
        endDateCalculated: endDate,
        ...(data.phase && { phase: data.phase }),
        ...(data.isMilestone !== undefined && {
          isMilestone: data.isMilestone,
        }),
        ...(data.percentComplete !== undefined && {
          percentComplete: data.percentComplete,
        }),
        ...(data.assignedTo !== undefined && {
          assignedTo: data.assignedTo,
        }),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(scheduleTasks.id, taskId));

    // propagate date changes to downstream tasks
    const schedule = await fetchScheduleData(db, task.projectId);
    const updatedTask = {
      ...task,
      status: task.status as TaskStatus,
      startDate,
      workdays,
      endDateCalculated: endDate,
    };
    const allTasks = schedule.tasks.map((t) =>
      t.id === taskId ? updatedTask : t,
    );
    const { updatedTasks, cycleDetected } = enforceDependencyDatesFrom(
      taskId,
      allTasks,
      schedule.dependencies,
      exceptions,
      true,
    );
    if (cycleDetected) {
      return {
        success: false,
        error: "The schedule contains a circular dependency",
      };
    }
    await persistDateUpdates(env.DB, updatedTasks);

    await recalcCriticalPath(db, env.DB, task.projectId);
    revalidatePath(`/dashboard/projects/${task.projectId}/schedule`);
    return { success: true };
  } catch (error) {
    console.error("Failed to update task:", error);
    return { success: false, error: "Failed to update task" };
  }
}

export async function deleteTask(
  taskId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await requireAuth();
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" };
    }
    const orgId = requireOrg(user);

    const { env } = await getCloudflareContext();
    const db = getDb(env.DB);

    const [task] = await db
      .select()
      .from(scheduleTasks)
      .where(eq(scheduleTasks.id, taskId))
      .limit(1);

    if (!task) return { success: false, error: "Task not found" };

    // verify project belongs to user's org
    const [project] = await db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.id, task.projectId),
          eq(projects.organizationId, orgId),
        ),
      )
      .limit(1);

    if (!project) {
      return { success: false, error: "Access denied" };
    }

    await db.delete(scheduleTasks).where(eq(scheduleTasks.id, taskId));
    await recalcCriticalPath(db, env.DB, task.projectId);
    revalidatePath(`/dashboard/projects/${task.projectId}/schedule`);
    return { success: true };
  } catch (error) {
    console.error("Failed to delete task:", error);
    return { success: false, error: "Failed to delete task" };
  }
}

export async function reorderTasks(
  projectId: string,
  items: { id: string; sortOrder: number }[],
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await requireAuth();
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" };
    }
    const orgId = requireOrg(user);

    const { env } = await getCloudflareContext();
    const db = getDb(env.DB);

    // verify project belongs to user's org
    const [project] = await db
      .select()
      .from(projects)
      .where(
        and(eq(projects.id, projectId), eq(projects.organizationId, orgId)),
      )
      .limit(1);

    if (!project) {
      return { success: false, error: "Project not found or access denied" };
    }

    for (const item of items) {
      await db
        .update(scheduleTasks)
        .set({ sortOrder: item.sortOrder })
        .where(eq(scheduleTasks.id, item.id));
    }

    revalidatePath(`/dashboard/projects/${projectId}/schedule`);
    return { success: true };
  } catch (error) {
    console.error("Failed to reorder tasks:", error);
    return { success: false, error: "Failed to reorder tasks" };
  }
}

export async function createDependency(data: {
  predecessorId: string;
  successorId: string;
  type: DependencyType;
  lagDays: number;
  projectId: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await requireAuth();
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" };
    }
    const orgId = requireOrg(user);

    const { env } = await getCloudflareContext();
    const db = getDb(env.DB);

    // verify project belongs to user's org
    const [project] = await db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.id, data.projectId),
          eq(projects.organizationId, orgId),
        ),
      )
      .limit(1);

    if (!project) {
      return { success: false, error: "Project not found or access denied" };
    }

    // get existing deps for cycle check
    const schedule = await fetchScheduleData(db, data.projectId);

    if (
      wouldCreateCycle(
        schedule.dependencies,
        data.predecessorId,
        data.successorId,
      )
    ) {
      return { success: false, error: "This dependency would create a cycle" };
    }

    await db.insert(taskDependencies).values({
      id: crypto.randomUUID(),
      predecessorId: data.predecessorId,
      successorId: data.successorId,
      type: data.type,
      lagDays: data.lagDays,
    });

    // propagate dates from predecessor
    const updatedSchedule = await fetchScheduleData(db, data.projectId);
    const { updatedTasks, cycleDetected } = propagateDates(
      data.predecessorId,
      updatedSchedule.tasks,
      updatedSchedule.dependencies,
      updatedSchedule.exceptions,
    );
    if (cycleDetected) {
      return {
        success: false,
        error: "The schedule contains a circular dependency",
      };
    }
    await persistDateUpdates(env.DB, updatedTasks);

    await recalcCriticalPath(db, env.DB, data.projectId);
    revalidatePath(`/dashboard/projects/${data.projectId}/schedule`);
    return { success: true };
  } catch (error) {
    console.error("Failed to create dependency:", error);
    return { success: false, error: "Failed to create dependency" };
  }
}

export async function deleteDependency(
  depId: string,
  projectId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await requireAuth();
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" };
    }
    const orgId = requireOrg(user);

    const { env } = await getCloudflareContext();
    const db = getDb(env.DB);

    // verify project belongs to user's org
    const [project] = await db
      .select()
      .from(projects)
      .where(
        and(eq(projects.id, projectId), eq(projects.organizationId, orgId)),
      )
      .limit(1);

    if (!project) {
      return { success: false, error: "Project not found or access denied" };
    }

    const [dependency] = await db
      .select()
      .from(taskDependencies)
      .where(eq(taskDependencies.id, depId))
      .limit(1);
    if (!dependency) {
      return { success: false, error: "Dependency not found" };
    }
    const [successorTask] = await db
      .select({ projectId: scheduleTasks.projectId })
      .from(scheduleTasks)
      .where(eq(scheduleTasks.id, dependency.successorId))
      .limit(1);
    if (successorTask?.projectId !== projectId) {
      return { success: false, error: "Dependency does not belong to this project" };
    }

    await db.delete(taskDependencies).where(eq(taskDependencies.id, depId));
    const schedule = await fetchScheduleData(db, projectId);
    const propagation = enforceDependencyDatesFrom(
      dependency.successorId,
      schedule.tasks,
      schedule.dependencies,
      schedule.exceptions,
      true,
    );
    if (!propagation.cycleDetected) {
      await persistDateUpdates(env.DB, propagation.updatedTasks);
    }
    await recalcCriticalPath(db, env.DB, projectId);
    revalidatePath(`/dashboard/projects/${projectId}/schedule`);
    return { success: true };
  } catch (error) {
    console.error("Failed to delete dependency:", error);
    return { success: false, error: "Failed to delete dependency" };
  }
}

export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await requireAuth();
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" };
    }
    const orgId = requireOrg(user);

    const { env } = await getCloudflareContext();
    const db = getDb(env.DB);

    const [task] = await db
      .select()
      .from(scheduleTasks)
      .where(eq(scheduleTasks.id, taskId))
      .limit(1);

    if (!task) return { success: false, error: "Task not found" };

    // verify project belongs to user's org
    const [project] = await db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.id, task.projectId),
          eq(projects.organizationId, orgId),
        ),
      )
      .limit(1);

    if (!project) {
      return { success: false, error: "Access denied" };
    }

    await db
      .update(scheduleTasks)
      .set({ status, updatedAt: new Date().toISOString() })
      .where(eq(scheduleTasks.id, taskId));

    revalidatePath(`/dashboard/projects/${task.projectId}/schedule`);
    return { success: true };
  } catch (error) {
    console.error("Failed to update task status:", error);
    return { success: false, error: "Failed to update status" };
  }
}

// recalculates critical path and updates all tasks
async function recalcCriticalPath(
  db: ReturnType<typeof getDb>,
  database: D1Database,
  projectId: string,
): Promise<void> {
  const tasks = await db
    .select()
    .from(scheduleTasks)
    .where(eq(scheduleTasks.projectId, projectId));

  const taskIds = tasks.map((task) => task.id);
  const deps: (typeof taskDependencies.$inferSelect)[] = [];
  for (let index = 0; index < taskIds.length; index += D1_BATCH_SIZE) {
    const predecessorIds = taskIds.slice(index, index + D1_BATCH_SIZE);
    deps.push(
      ...(await db
        .select()
        .from(taskDependencies)
        .where(inArray(taskDependencies.predecessorId, predecessorIds))),
    );
  }
  const taskIdSet = new Set(taskIds);
  const projectDeps = deps.filter(
    (dependency) => taskIdSet.has(dependency.successorId),
  );

  const criticalSet = findCriticalPath(
    tasks.map((t) => ({ ...t, status: t.status as TaskStatus })),
    projectDeps.map((d) => ({ ...d, type: d.type as DependencyType })),
  );

  const changedTasks = tasks.filter(
    (task) => task.isCriticalPath !== criticalSet.has(task.id),
  );
  if (changedTasks.length === 0) return;
  await executePreparedInBatches(
    database,
    changedTasks.map((task) =>
      database
        .prepare(
          "UPDATE schedule_tasks SET is_critical_path = ? WHERE id = ?",
        )
        .bind(criticalSet.has(task.id) ? 1 : 0, task.id),
    ),
  );
}
