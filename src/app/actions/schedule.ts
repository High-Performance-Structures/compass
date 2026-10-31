"use server"

import { and, asc, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { projectOperations, projects, scheduleTasks, workdayExceptions } from "@/db/schema"
import { recordActivityEvent } from "@/lib/activity-log"
import { chunkD1Values } from "@/lib/d1-query"
import {
  canViewWorkingSchedule,
  readProjectSchedule,
  readWorkingSchedule,
  scheduleReadContext,
  scheduleSwitcherProjects,
  scheduleWriteContext,
  viewerProjects,
} from "@/lib/domain/schedule/access"
import {
  findTask,
  isOrganizationProject,
  loadDependenciesForTasks,
  loadProjectExceptions,
  loadTaskPeople,
  nextProjectSortOrder,
  resolveAssignedUserId,
  resolveScheduleTaskPeople,
} from "@/lib/domain/schedule/queries"
import {
  dependencyData,
  exceptionDataCast,
  legacyAssignment,
  ownerSchedulePaths,
  propagateFrom,
  requestedAssignees,
  schedulePaths,
  taskEditValues,
  taskWithProgress,
  type TaskDates,
} from "@/lib/domain/schedule/rules"
import {
  clearTaskAssigneesQuery,
  deleteTask as deleteTaskRow,
  insertTask,
  persistScheduleDateUpdates,
  recalcCriticalPath,
  replaceTaskPeopleQueries,
  resetTaskAssigneesQuery,
  taskInsertQuery,
  taskUpdateQuery,
} from "@/lib/domain/schedule/store"
import { updateProjects } from "@/lib/domain/project/store"
import { loadScheduleTemplateItemImport } from "@/lib/domain/schedule/template-items"
import { operationInsertQuery } from "@/lib/domain/operations/store"
import { projectDepartment } from "@/lib/project-branding"
import type { ProjectListItem } from "@/lib/projects/project-list"
import { samePeople, type ScheduleAssigneeInput } from "@/lib/schedule/assignees"
import { calculateEndDate } from "@/lib/schedule/business-days"
import { newScheduleConfirmationState } from "@/lib/schedule/confirmation"
import { normalizeScheduleItemTimes } from "@/lib/schedule/item-time"
import { isOwnerScheduleView, type OwnerScheduleView } from "@/lib/schedule/owner-visibility"
import { normalizeScheduleProgress } from "@/lib/schedule/progress"
import { projectScheduleColor } from "@/lib/schedule/project-scope"
import { isScheduleShiftReasonRequired } from "@/lib/schedule/publication-history"
import { recordScheduleShift } from "@/lib/schedule/record-shift"
import { resolveScheduleShiftReason, summarizeScheduleShift } from "@/lib/schedule/shift-tracking"
import type { ScheduleData, ScopedScheduleData, TaskStatus } from "@/lib/schedule/types"
import { selectTemplateTodos } from "@/lib/templates/template-todo-selection"
import { isInternalStaffRole } from "@/lib/user-roles"

function emptyScopedSchedule(): ScopedScheduleData {
  return { projects: [], tasks: [], dependencies: [], exceptions: [] }
}

export async function getSchedule(projectId: string): Promise<ScheduleData> {
  return readProjectSchedule(projectId)
}

export async function getOwnerScheduleView(projectId: string): Promise<OwnerScheduleView> {
  const { db, organizationId } = await scheduleReadContext()
  const accessibleProjects = await viewerProjects()
  if (!accessibleProjects.some((project) => project.id === projectId)) {
    throw new Error("Project not found or access denied")
  }

  const project = await db
    .select({ ownerScheduleView: projects.ownerScheduleView })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
    .get()

  if (!project) throw new Error("Project not found or access denied")
  return isOwnerScheduleView(project.ownerScheduleView) ? project.ownerScheduleView : "items"
}

export async function updateOwnerScheduleView(
  projectId: string,
  ownerScheduleView: string
): Promise<{ readonly success: true } | { readonly success: false; readonly error: string }> {
  try {
    const context = await scheduleWriteContext()
    if (!context.success) return context
    const { db, organizationId, user } = context.data
    if (!isInternalStaffRole(user.role)) {
      return {
        success: false,
        error: "Only internal project staff can change owner schedule access."
      }
    }
    if (!isOwnerScheduleView(ownerScheduleView)) {
      return { success: false, error: "Unsupported owner schedule view." }
    }

    const existing = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
      .get()

    if (!existing) {
      return { success: false, error: "Project not found or access denied" }
    }

    await updateProjects(db, eq(projects.id, projectId), {
      ownerScheduleView,
      updatedAt: new Date().toISOString()
    })

    await recordActivityEvent({
      db,
      organizationId,
      projectId,
      actor: user,
      category: "schedule",
      action: "schedule.owner_visibility_changed",
      entityType: "project_schedule",
      entityId: projectId,
      summary:
        ownerScheduleView === "phases"
          ? "Changed the owner schedule to phase-only visibility."
          : "Changed the owner schedule to item-level visibility."
    })
    for (const path of ownerSchedulePaths(projectId)) revalidatePath(path)
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to update the owner schedule view."
    }
  }
}

export async function getScopedSchedule(
  requestedProjectIds?: readonly string[]
): Promise<ScopedScheduleData> {
  const { db, organizationId, user } = await scheduleReadContext()
  if (!canViewWorkingSchedule(user.role)) return emptyScopedSchedule()
  const accessibleProjects = await viewerProjects()
  const requestedIds = new Set(
    requestedProjectIds?.map((projectId) => projectId.trim()).filter(Boolean) ?? []
  )
  const selectedProjects =
    requestedProjectIds === undefined
      ? accessibleProjects
      : accessibleProjects.filter((project) => requestedIds.has(project.id))

  const scopedProjects = selectedProjects.map((project) => ({
    id: project.id,
    name: project.name,
    projectNumber: project.projectNumber,
    department: projectDepartment({
      projectId: project.id,
      projectNumber: project.projectNumber
    }),
    color: projectScheduleColor(project.id)
  }))

  if (scopedProjects.length === 0) return emptyScopedSchedule()

  const projectIds = scopedProjects.map((project) => project.id)
  const verifiedProjects = (
    await Promise.all(
      chunkD1Values(projectIds).map((projectIdChunk) =>
        db
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.organizationId, organizationId), inArray(projects.id, projectIdChunk)))
      )
    )
  ).flat()
  const verifiedProjectIds = new Set(verifiedProjects.map((project) => project.id))
  const safeProjectIds = projectIds.filter((projectId) => verifiedProjectIds.has(projectId))

  if (safeProjectIds.length === 0) return emptyScopedSchedule()

  const [taskChunks, exceptionChunks] = await Promise.all([
    Promise.all(
      chunkD1Values(safeProjectIds).map((projectIdChunk) =>
        db
          .select()
          .from(scheduleTasks)
          .where(inArray(scheduleTasks.projectId, projectIdChunk))
          .orderBy(
            asc(scheduleTasks.startDate),
            asc(scheduleTasks.sortOrder),
            asc(scheduleTasks.title)
          )
      )
    ),
    Promise.all(
      chunkD1Values(safeProjectIds).map((projectIdChunk) =>
        db
          .select()
          .from(workdayExceptions)
          .where(inArray(workdayExceptions.projectId, projectIdChunk))
      )
    )
  ])
  const tasks = taskChunks
    .flat()
    .sort(
      (left, right) =>
        left.startDate.localeCompare(right.startDate) ||
        left.sortOrder - right.sortOrder ||
        left.title.localeCompare(right.title)
    )
  const taskIds = tasks.map((task) => task.id)
  const [dependencies, peopleByTask] = await Promise.all([
    loadDependenciesForTasks(db, taskIds),
    loadTaskPeople(db, taskIds),
  ])

  return {
    projects: scopedProjects.filter((project) => verifiedProjectIds.has(project.id)),
    tasks: tasks.map((task) => ({ ...taskWithProgress(task), people: peopleByTask.get(task.id) ?? [] })),
    dependencies: dependencies.map(dependencyData),
    exceptions: exceptionChunks.flat().map(exceptionDataCast)
  }
}

export async function getScheduleProjectSwitcherProjects(
  currentProjectId: string,
): Promise<ProjectListItem[]> {
  return scheduleSwitcherProjects(currentProjectId)
}

export async function createTask(
  projectId: string,
  data: {
    title: string
    startDate: string
    workdays: number
    startTime?: string | null
    endTime?: string | null
    phase: string
    displayColor?: string
    status?: TaskStatus
    isMilestone?: boolean
    percentComplete?: number
    /** Everyone assigned, in picked order; replaces assignedTo when given. */
    assignees?: readonly ScheduleAssigneeInput[]
    assignedTo?: string
    assignedOptionId?: string | null
    ownerVisible?: boolean
    subVendorVisible?: boolean
    confirmationRequired?: boolean
    notes?: string | null
    templateScheduleItemId?: string | null
    templateTodoIds?: readonly string[]
  }
): Promise<
  | {
      readonly success: true
      readonly taskId: string
      readonly linkedTodoCount: number
    }
  | { readonly success: false; readonly error: string }
> {
  try {
    const context = await scheduleWriteContext()
    if (!context.success) return context
    const { db, organizationId: orgId, user } = context.data

    if (!(await isOrganizationProject(db, orgId, projectId))) {
      return { success: false, error: "Project not found or access denied" }
    }

    const templateImport = data.templateScheduleItemId
      ? await loadScheduleTemplateItemImport(db, orgId, data.templateScheduleItemId)
      : null
    if (data.templateScheduleItemId && !templateImport) {
      return {
        success: false,
        error: "That published template schedule item is no longer available."
      }
    }
    if (!templateImport && (data.templateTodoIds?.length ?? 0) > 0) {
      return {
        success: false,
        error: "Choose a published template schedule item before adding template to-dos."
      }
    }
    const todoSelection = selectTemplateTodos(
      templateImport?.linkedTodos ?? [],
      data.templateTodoIds ?? []
    )
    if (todoSelection.missingIds.length > 0) {
      return {
        success: false,
        error: "One or more selected template to-dos are no longer available."
      }
    }

    const times = normalizeScheduleItemTimes(data.startTime, data.endTime)
    if (!times.success) return { success: false, error: times.error }

    const exceptions = await loadProjectExceptions(db, projectId)
    const endDate = calculateEndDate(data.startDate, data.workdays, exceptions)
    const now = new Date().toISOString()
    const nextOrder = await nextProjectSortOrder(db, projectId)

    const id = crypto.randomUUID()
    const assigneeRequest = requestedAssignees(data)
    if (assigneeRequest && "error" in assigneeRequest) return { success: false, error: assigneeRequest.error }
    const people = assigneeRequest
      ? await resolveScheduleTaskPeople(db, orgId, projectId, assigneeRequest.inputs)
      : []
    const { assignedTo, assignedUserId } = legacyAssignment(people)
    const confirmationRequired = data.confirmationRequired ?? false
    const confirmation = newScheduleConfirmationState({
      required: confirmationRequired,
      assignedUserId,
      now
    })
    const progress = normalizeScheduleProgress(data.status ?? "PENDING", data.percentComplete ?? 0)
    const scheduleTaskRow: typeof scheduleTasks.$inferInsert = {
      id,
      projectId,
      title: data.title,
      notes: data.notes?.trim() || null,
      startDate: data.startDate,
      workdays: data.workdays,
      endDateCalculated: endDate,
      startTime: times.startTime,
      endTime: times.endTime,
      phase: data.phase,
      displayColor: data.displayColor ?? "blue",
      status: progress.status,
      isCriticalPath: false,
      isMilestone: data.isMilestone ?? false,
      percentComplete: progress.percentComplete,
      assignedTo,
      assignedUserId,
      ownerVisible: data.ownerVisible ?? true,
      subVendorVisible: data.subVendorVisible ?? false,
      confirmationRequired,
      confirmationStatus: confirmation.status,
      confirmationRequestedAt: confirmation.requestedAt,
      sortOrder: nextOrder,
      createdAt: now,
      updatedAt: now
    }
    const linkedTodoRows: (typeof projectOperations.$inferInsert)[] = templateImport
      ? todoSelection.selected.map((todo) => ({
          id: crypto.randomUUID(),
          projectId,
          sourceSystem: "compass_template",
          sourceRecordType: "schedule_task",
          sourceRecordId: id,
          title: todo.title,
          description: todo.description,
          status: "open",
          priority: "normal",
          assigneeType: "internal",
          startDate: data.startDate,
          dueDate: endDate,
          sageWriteStatus: "not_ready",
          sagePayloadJson: JSON.stringify({
            source: "project_template_schedule_item",
            templateId: templateImport.templateId,
            templateName: templateImport.templateName,
            versionId: templateImport.versionId,
            scheduleTemplateItemId: templateImport.scheduleTemplateItemId,
            templateContentItemId: todo.templateContentItemId,
            sourceItemId: todo.sourceItemId,
            checklistItems: todo.checklistItems
          }),
          syncDirection: "write",
          syncStatus: "compass_only",
          createdAt: now,
          updatedAt: now
        }))
      : []

    if (linkedTodoRows.length > 0 || people.length > 0) {
      // Keep each to-do in its own prepared statement. D1 limits the number of
      // bound values in one statement, so a multi-row insert fails for larger
      // templates even though the surrounding batch is otherwise valid.
      await db.batch([
        taskInsertQuery(db, scheduleTaskRow),
        ...replaceTaskPeopleQueries(db, id, people, now),
        ...linkedTodoRows.map((todoRow) => operationInsertQuery(db, todoRow))
      ])
    } else {
      await insertTask(db, scheduleTaskRow)
    }

    await recordActivityEvent({
      db,
      organizationId: orgId,
      projectId,
      actor: user,
      category: "schedule",
      action: "schedule.item_created",
      entityType: "schedule_item",
      entityId: id,
      summary: `Created schedule item “${data.title}”.`,
      metadata: templateImport
        ? {
            templateId: templateImport.templateId,
            templateName: templateImport.templateName,
            scheduleTemplateItemId: templateImport.scheduleTemplateItemId,
            linkedTodoCount: linkedTodoRows.length
          }
        : undefined
    })

    await recalcCriticalPath(db, projectId)
    for (const path of schedulePaths(projectId)) revalidatePath(path)
    return {
      success: true,
      taskId: id,
      linkedTodoCount: linkedTodoRows.length
    }
  } catch (error) {
    console.error("Failed to create task:", error)
    return { success: false, error: "Failed to create schedule item" }
  }
}

export async function updateTask(
  taskId: string,
  data: {
    title?: string
    startDate?: string
    workdays?: number
    startTime?: string | null
    endTime?: string | null
    phase?: string
    displayColor?: string
    status?: TaskStatus
    isMilestone?: boolean
    percentComplete?: number
    /** Everyone assigned, in picked order; replaces assignedTo when given. */
    assignees?: readonly ScheduleAssigneeInput[]
    assignedTo?: string | null
    assignedOptionId?: string | null
    ownerVisible?: boolean
    subVendorVisible?: boolean
    confirmationRequired?: boolean
    acceptChangeProposal?: boolean
    shiftReason?: string
    notes?: string | null
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const context = await scheduleWriteContext()
    if (!context.success) return context
    const { db, organizationId: orgId, user, env } = context.data

    const task = await findTask(db, taskId)
    if (!task) return { success: false, error: "Schedule item not found" }
    if (!(await isOrganizationProject(db, orgId, task.projectId))) {
      return { success: false, error: "Access denied" }
    }

    const schedule = await readWorkingSchedule(context.data, task.projectId)
    const exceptions = schedule.exceptions
    const startDate = data.startDate ?? task.startDate
    const workdays = data.workdays ?? task.workdays
    const endDate = calculateEndDate(startDate, workdays, exceptions)
    const progress = normalizeScheduleProgress(
      (data.status ?? task.status) as TaskStatus,
      data.percentComplete ?? task.percentComplete
    )
    const assigneeRequest = requestedAssignees(data)
    if (assigneeRequest && "error" in assigneeRequest) return { success: false, error: assigneeRequest.error }
    const people = assigneeRequest
      ? await resolveScheduleTaskPeople(db, orgId, task.projectId, assigneeRequest.inputs)
      : null
    const storedPeople = people ? ((await loadTaskPeople(db, [taskId])).get(taskId) ?? []) : []
    // The form sends the whole list: assigned_to holds every name and
    // assigned_user_id the first linked account. A legacy single-name edit
    // keeps today's rules for assigned_user_id.
    const fromList = people !== null && data.assignees !== undefined
    const editData = fromList
      ? { ...data, assignedTo: legacyAssignment(people).assignedTo, assignedOptionId: null }
      : data
    const assignedUserId = fromList
      ? legacyAssignment(people).assignedUserId
      : data.assignedOptionId !== undefined
        ? await resolveAssignedUserId(db, orgId, task.projectId, data.assignedOptionId)
        : data.assignedTo === null
          ? null
          : task.assignedUserId
    const assignmentChanged =
      (editData.assignedTo !== undefined && editData.assignedTo !== task.assignedTo) ||
      ((fromList || data.assignedOptionId !== undefined) && assignedUserId !== task.assignedUserId)
    const confirmationRequired = data.confirmationRequired ?? task.confirmationRequired
    const resetConfirmation =
      assignmentChanged ||
      (data.confirmationRequired !== undefined &&
        data.confirmationRequired !== task.confirmationRequired)
    const scheduleDatesChanged =
      startDate !== task.startDate || workdays !== task.workdays
    const acceptChangeProposal =
      data.acceptChangeProposal === true &&
      task.proposedStartDate !== null &&
      task.proposedWorkdays !== null
    const now = new Date().toISOString()
    const confirmation = newScheduleConfirmationState({
      required: confirmationRequired,
      assignedUserId,
      now
    })
    const peopleQueries =
      people && !samePeople(storedPeople, people) ? replaceTaskPeopleQueries(db, taskId, people, now) : []

    // Only propagate and invalidate assignee responses when the schedule dates
    // actually changed. Ordinary metadata edits must preserve confirmations.
    const updatedTask = {
      ...task,
      status: progress.status,
      percentComplete: progress.percentComplete,
      startDate,
      workdays,
      endDateCalculated: endDate
    }
    const allTasks = schedule.tasks.map((t) => (t.id === taskId ? updatedTask : t))
    const dateUpdates = new Map<string, TaskDates>()
    if (scheduleDatesChanged) {
      for (const [updatedTaskId, dates] of propagateFrom(
        taskId,
        allTasks,
        schedule.dependencies,
        exceptions
      )) {
        dateUpdates.set(updatedTaskId, dates)
      }
      dateUpdates.set(taskId, { startDate, endDateCalculated: endDate })
    }
    const shiftSummary = summarizeScheduleShift(schedule.tasks, dateUpdates)
    const shiftReasonResult = resolveScheduleShiftReason(
      shiftSummary.affectedItemCount > 0 &&
        (await isScheduleShiftReasonRequired(db, task.projectId)),
      data.shiftReason
    )
    if (shiftReasonResult !== null && !shiftReasonResult.success) {
      return { success: false, error: shiftReasonResult.error }
    }
    const timesChanged = data.startTime !== undefined || data.endTime !== undefined
    const times = normalizeScheduleItemTimes(
      data.startTime !== undefined ? data.startTime : task.startTime,
      data.endTime !== undefined ? data.endTime : task.endTime
    )
    if (timesChanged && !times.success) {
      return { success: false, error: times.error }
    }

    // Leave dates untouched until the paired D1 batch below. Linked to-dos
    // must calculate their offsets from the previous schedule dates.
    const taskUpdate = taskUpdateQuery(
      db,
      taskId,
      taskEditValues({
        data: editData,
        workdays,
        status: progress.status,
        percentComplete: progress.percentComplete,
        times: timesChanged && times.success ? times : null,
        assignedUserId,
        confirmationRequired,
        restartConfirmation: resetConfirmation ? confirmation : null,
        acceptChangeProposal,
        now
      })
    )
    if (assignmentChanged) {
      // Legacy scalar assignment changes invalidate normalized assignees. The
      // child rows carry independent response authority and cannot be left
      // attached to a newly assigned scalar task.
      await db.batch([taskUpdate, clearTaskAssigneesQuery(db, taskId), ...peopleQueries])
    } else if (scheduleDatesChanged || resetConfirmation) {
      await db.batch([
        taskUpdate,
        resetTaskAssigneesQuery(db, taskId, { startDate, workdays, endDate }, now),
        ...peopleQueries,
      ])
    } else {
      await db.batch([taskUpdate, ...peopleQueries])
    }
    await persistScheduleDateUpdates(env.DB, task.projectId, dateUpdates, now)
    if (shiftReasonResult?.success) {
      await recordScheduleShift({
        db,
        organizationId: orgId,
        projectId: task.projectId,
        actor: user,
        sourceType: "schedule_item",
        sourceId: taskId,
        sourceLabel: `“${data.title ?? task.title}”`,
        reason: shiftReasonResult.reason,
        summary: shiftSummary,
      })
    }

    await recordActivityEvent({
      db,
      organizationId: orgId,
      projectId: task.projectId,
      actor: user,
      category: "schedule",
      action: "schedule.item_updated",
      entityType: "schedule_item",
      entityId: taskId,
      summary: `Updated schedule item “${data.title ?? task.title}”.`
    })

    if (acceptChangeProposal) {
      await recordActivityEvent({
        db,
        organizationId: orgId,
        projectId: task.projectId,
        actor: user,
        category: "schedule",
        action: "schedule.assignment_change_accepted",
        entityType: "schedule_item",
        entityId: taskId,
        summary: `Applied the subcontractor's proposed dates to the draft for “${
          data.title ?? task.title
        }”.`,
        metadata: {
          proposedStartDate: task.proposedStartDate,
          proposedWorkdays: task.proposedWorkdays,
          savedStartDate: startDate,
          savedWorkdays: workdays
        }
      })
    }

    await recalcCriticalPath(db, task.projectId)
    for (const path of schedulePaths(task.projectId)) revalidatePath(path)
    return { success: true }
  } catch (error) {
    console.error("Failed to update task:", error)
    return { success: false, error: "Failed to update schedule item" }
  }
}

export async function deleteTask(taskId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const context = await scheduleWriteContext()
    if (!context.success) return context
    const { db, organizationId: orgId, user } = context.data

    const task = await findTask(db, taskId)
    if (!task) return { success: false, error: "Schedule item not found" }
    if (!(await isOrganizationProject(db, orgId, task.projectId))) {
      return { success: false, error: "Access denied" }
    }

    await deleteTaskRow(db, taskId)
    await recordActivityEvent({
      db,
      organizationId: orgId,
      projectId: task.projectId,
      actor: user,
      category: "schedule",
      action: "schedule.item_deleted",
      entityType: "schedule_item",
      entityId: taskId,
      summary: `Deleted schedule item “${task.title}”.`
    })
    await recalcCriticalPath(db, task.projectId)
    for (const path of schedulePaths(task.projectId)) revalidatePath(path)
    return { success: true }
  } catch (error) {
    console.error("Failed to delete task:", error)
    return { success: false, error: "Failed to delete schedule item" }
  }
}
