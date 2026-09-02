"use server"

import { getCloudflareContext } from "@/lib/db"
import { getDb } from "@/db"
import {
  scheduleTasks,
  taskDependencies,
  workdayExceptions,
  projects,
  projectOperations,
  organizationMembers,
  projectAccessInvitations,
  users
} from "@/db/schema"
import {
  projectTemplateContentItems,
  projectTemplateApplicationItems,
  projectTemplateApplications,
  projectTemplates,
  projectTemplateVersions,
  scheduleTemplateDependencies,
  scheduleTemplateItems
} from "@/db/schema-templates"
import { scheduleTaskAssignees } from "@/db/schema-participants"
import { eq, asc, and, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { calculateEndDate } from "@/lib/schedule/business-days"
import { findCriticalPath } from "@/lib/schedule/critical-path"
import {
  wouldCreateCycle,
  wouldDependencyUpdateCreateCycle
} from "@/lib/schedule/dependency-validation"
import { propagateDates } from "@/lib/schedule/propagate-dates"
import { effectivePercentComplete, normalizeScheduleProgress } from "@/lib/schedule/progress"
import { newScheduleConfirmationState } from "@/lib/schedule/confirmation"
import { requireAuth } from "@/lib/auth"
import { requireOrg } from "@/lib/org-scope"
import { isDemoUser } from "@/lib/demo"
import { getProjects, type ProjectListItem } from "@/app/actions/projects"
import { projectDepartment } from "@/lib/project-branding"
import {
  projectScheduleColor,
  schedulePortfolioProjects,
} from "@/lib/schedule/project-scope"
import { requirePermission } from "@/lib/permissions"
import { isInternalStaffRole } from "@/lib/user-roles"
import { recordActivityEvent } from "@/lib/activity-log"
import {
  formatTemplateChecklist,
  groupTemplateChecklistItems
} from "@/lib/templates/template-checklist-hierarchy"
import { selectTemplateTodos } from "@/lib/templates/template-todo-selection"
import { buildScheduleTemplateApplication } from "@/lib/templates/schedule-template-application"
import {
  normalizeBulkScheduleTemplateOffsets,
  validateBulkScheduleTemplateSelection,
  type BulkScheduleTemplateSelection
} from "@/lib/templates/schedule-template-bulk-selection"
import { isOwnerScheduleView, type OwnerScheduleView } from "@/lib/schedule/owner-visibility"
import { linkedTodoDateUpdateStatement } from "@/lib/schedule/linked-todo-sync"
import { recordScheduleShift } from "@/lib/schedule/record-shift"
import {
  summarizeScheduleShift,
  validateScheduleShiftReason,
} from "@/lib/schedule/shift-tracking"
import type {
  TaskStatus,
  DependencyType,
  ExceptionCategory,
  ExceptionRecurrence,
  ScheduleData,
  ScheduleTaskAssigneeData,
  ScopedScheduleData,
  WorkdayExceptionData,
  WorkdayExceptionType
} from "@/lib/schedule/types"

function revalidateSchedulePaths(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}/schedule`)
  revalidatePath(`/dashboard/projects/${projectId}/todos`)
  revalidatePath("/dashboard")
  revalidatePath("/dashboard/schedule")
}

async function persistScheduleDateUpdates(
  database: D1Database,
  projectId: string,
  updates: ReadonlyMap<
    string,
    {
      readonly startDate: string
      readonly endDateCalculated: string
    }
  >,
  updatedAt: string
): Promise<void> {
  const entries = [...updates]
  // Three statements are required per item. Keep batches below D1's statement
  // ceiling while preserving the linked-to-do update before its schedule row.
  // Every propagated date change invalidates responses frozen against the old
  // dates, not just the task that initiated the dependency cascade.
  for (const entryChunk of chunkValues(entries, 40)) {
    const statements = entryChunk.flatMap(([taskId, dates]) => [
      linkedTodoDateUpdateStatement(database, {
        scheduleTaskId: taskId,
        nextStartDate: dates.startDate,
        nextEndDate: dates.endDateCalculated,
        updatedAt,
      }),
      database
        .prepare(
          `UPDATE schedule_tasks
           SET start_date = ?, end_date_calculated = ?, updated_at = ?
           WHERE id = ? AND project_id = ?`
        )
        .bind(
          dates.startDate,
          dates.endDateCalculated,
          updatedAt,
          taskId,
          projectId
        ),
      database
        .prepare(
          `UPDATE schedule_task_assignees
           SET source_start_date = ?,
               source_end_date = ?,
               response_status = 'pending',
               date_response_status = 'pending',
               duration_response_status = 'pending',
               proposed_start_date = NULL,
               proposed_workdays = NULL,
               proposed_end_date = NULL,
               response_message = NULL,
               responded_at = NULL,
               responded_by_user_id = NULL,
               response_source = NULL,
               assigned_at = ?,
               updated_at = ?
           WHERE schedule_task_id = ?`
        )
        .bind(
          dates.startDate,
          dates.endDateCalculated,
          updatedAt,
          updatedAt,
          taskId
        ),
    ])
    const results = await database.batch(statements)
    if (results.some((result) => !result.success)) {
      throw new Error("Schedule date update batch failed")
    }
  }
}

function revalidateOwnerSchedulePaths(projectId: string): void {
  revalidateSchedulePaths(projectId)
  revalidatePath(`/preview/projects/${projectId}/owner`)
  revalidatePath(`/preview/projects/${projectId}/owner/schedule`)
}

function chunkValues<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

async function fetchExceptions(
  db: ReturnType<typeof getDb>,
  projectId: string
): Promise<WorkdayExceptionData[]> {
  const rows = await db
    .select()
    .from(workdayExceptions)
    .where(eq(workdayExceptions.projectId, projectId))

  return rows.map((r) => ({
    ...r,
    type: r.type as WorkdayExceptionType,
    category: r.category as ExceptionCategory,
    recurrence: r.recurrence as ExceptionRecurrence
  }))
}

type ScheduleTemplateLinkedTodo = {
  readonly templateContentItemId: string
  readonly sourceItemId: string | null
  readonly title: string
  readonly description: string | null
  readonly checklistItems: readonly {
    readonly templateContentItemId: string
    readonly sourceItemId: string | null
    readonly title: string
    readonly description: string | null
    readonly sortOrder: number
  }[]
}

type ScheduleTemplateItemImport = {
  readonly templateId: string
  readonly templateName: string
  readonly versionId: string
  readonly scheduleTemplateItemId: string
  readonly linkedTodos: readonly ScheduleTemplateLinkedTodo[]
}

function joinedDescription(parts: readonly (string | null)[]): string | null {
  const content = parts.flatMap((part) => {
    const cleaned = part?.trim()
    return cleaned ? [cleaned] : []
  })
  return content.length > 0 ? content.join("\n\n") : null
}

async function loadScheduleTemplateItemImport(
  db: ReturnType<typeof getDb>,
  organizationId: string,
  templateItemId: string
): Promise<ScheduleTemplateItemImport | null> {
  const rows = await db
    .select({
      templateId: projectTemplates.id,
      templateName: projectTemplates.name,
      versionId: projectTemplateVersions.id,
      scheduleTemplateItemId: scheduleTemplateItems.id
    })
    .from(scheduleTemplateItems)
    .innerJoin(
      projectTemplateVersions,
      eq(projectTemplateVersions.id, scheduleTemplateItems.versionId)
    )
    .innerJoin(projectTemplates, eq(projectTemplates.id, projectTemplateVersions.templateId))
    .where(
      and(
        eq(scheduleTemplateItems.id, templateItemId),
        eq(projectTemplates.organizationId, organizationId),
        eq(projectTemplates.lifecycleStatus, "active"),
        eq(projectTemplates.reviewStatus, "verified"),
        eq(projectTemplateVersions.status, "published"),
        eq(projectTemplateVersions.versionNumber, projectTemplates.currentVersionNumber)
      )
    )
    .limit(1)
  const selected = rows[0]
  if (!selected) return null

  const linkedTodos = await loadScheduleTemplateTodos(db, selected.versionId)

  return { ...selected, linkedTodos }
}

async function loadScheduleTemplateTodos(
  db: ReturnType<typeof getDb>,
  versionId: string
): Promise<readonly ScheduleTemplateLinkedTodo[]> {
  const taskItems = await db
    .select()
    .from(projectTemplateContentItems)
    .where(
      and(
        eq(projectTemplateContentItems.versionId, versionId),
        eq(projectTemplateContentItems.moduleType, "tasks")
      )
    )
    .orderBy(asc(projectTemplateContentItems.sortOrder))
  const linkedTodos = groupTemplateChecklistItems(taskItems).map((group) => ({
    templateContentItemId: group.task.id,
    sourceItemId: group.task.sourceItemId,
    title: group.task.title.trim(),
    description: joinedDescription([
      group.task.description,
      formatTemplateChecklist(group.checklistItems)
    ]),
    checklistItems: group.checklistItems.map((item) => ({
      templateContentItemId: item.id,
      sourceItemId: item.sourceItemId,
      title: item.title,
      description: item.description,
      sortOrder: item.sortOrder
    }))
  }))

  return linkedTodos
}

async function resolveAssignedUserId(
  db: ReturnType<typeof getDb>,
  organizationId: string,
  projectId: string,
  assigneeOptionId: string | null | undefined
): Promise<string | null> {
  if (!assigneeOptionId) return null

  if (assigneeOptionId.startsWith("team:")) {
    const userId = assigneeOptionId.slice("team:".length)
    const member = await db
      .select({ userId: users.id })
      .from(users)
      .innerJoin(organizationMembers, eq(organizationMembers.userId, users.id))
      .where(
        and(
          eq(users.id, userId),
          eq(users.isActive, true),
          eq(organizationMembers.organizationId, organizationId)
        )
      )
      .get()
    return member?.userId ?? null
  }

  if (assigneeOptionId.startsWith("project:")) {
    const projectContactId = assigneeOptionId.slice("project:".length)
    const invitation = await db
      .select({ userId: projectAccessInvitations.acceptedBy })
      .from(projectAccessInvitations)
      .where(
        and(
          eq(projectAccessInvitations.organizationId, organizationId),
          eq(projectAccessInvitations.projectId, projectId),
          eq(projectAccessInvitations.projectContactId, projectContactId),
          eq(projectAccessInvitations.status, "accepted")
        )
      )
      .get()
    return invitation?.userId ?? null
  }

  return null
}

export async function getSchedule(projectId: string): Promise<ScheduleData> {
  const user = await requireAuth()
  requirePermission(user, "schedule", "read")
  const orgId = requireOrg(user)
  const accessibleProjects = await getScheduleProjects()
  if (!accessibleProjects.some((project) => project.id === projectId)) {
    throw new Error("Project not found or access denied")
  }

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  // verify project belongs to user's org
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
    .limit(1)

  if (!project) {
    throw new Error("Project not found or access denied")
  }

  const tasks = await db
    .select()
    .from(scheduleTasks)
    .where(eq(scheduleTasks.projectId, projectId))
    .orderBy(asc(scheduleTasks.sortOrder))

  const assigneeRows = await db
    .select()
    .from(scheduleTaskAssignees)
    .where(inArray(scheduleTaskAssignees.scheduleTaskId, tasks.map((task) => task.id)))
    .catch(() => [])
  const assigneesByTask = new Map<string, ScheduleTaskAssigneeData[]>()
  for (const row of assigneeRows) {
    const existing = assigneesByTask.get(row.scheduleTaskId) ?? []
    existing.push(row)
    assigneesByTask.set(row.scheduleTaskId, existing)
  }

  const deps = await db.select().from(taskDependencies)
  const exceptions = await fetchExceptions(db, projectId)

  const taskIds = new Set(tasks.map((t) => t.id))
  const projectDeps = deps.filter((d) => taskIds.has(d.predecessorId) && taskIds.has(d.successorId))

  return {
    tasks: tasks.map((t) => {
      const status = t.status as TaskStatus
      return {
        ...t,
        status,
        phase: t.phase,
        percentComplete: effectivePercentComplete(status, t.percentComplete),
        assignees: assigneesByTask.get(t.id) ?? [],
      }
    }),
    dependencies: projectDeps.map((d) => ({
      ...d,
      type: d.type as DependencyType
    })),
    exceptions
  }
}

export async function getOwnerScheduleView(projectId: string): Promise<OwnerScheduleView> {
  const user = await requireAuth()
  requirePermission(user, "schedule", "read")
  const orgId = requireOrg(user)
  const accessibleProjects = await getProjects()
  if (!accessibleProjects.some((project) => project.id === projectId)) {
    throw new Error("Project not found or access denied")
  }

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const project = await db
    .select({ ownerScheduleView: projects.ownerScheduleView })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
    .get()

  if (!project) throw new Error("Project not found or access denied")
  return isOwnerScheduleView(project.ownerScheduleView) ? project.ownerScheduleView : "items"
}

export async function updateOwnerScheduleView(
  projectId: string,
  ownerScheduleView: string
): Promise<{ readonly success: true } | { readonly success: false; readonly error: string }> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "schedule", "update")
    if (!isInternalStaffRole(user.role)) {
      return {
        success: false,
        error: "Only internal project staff can change owner schedule access."
      }
    }
    if (!isOwnerScheduleView(ownerScheduleView)) {
      return { success: false, error: "Unsupported owner schedule view." }
    }

    const orgId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const existing = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
      .get()

    if (!existing) {
      return { success: false, error: "Project not found or access denied" }
    }

    await db
      .update(projects)
      .set({
        ownerScheduleView,
        updatedAt: new Date().toISOString()
      })
      .where(eq(projects.id, projectId))

    await recordActivityEvent({
      db,
      organizationId: orgId,
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
    revalidateOwnerSchedulePaths(projectId)
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
  const user = await requireAuth()
  requirePermission(user, "schedule", "read")
  const orgId = requireOrg(user)
  const accessibleProjects = await getProjects()
  const requestedIds = new Set(
    requestedProjectIds?.map((projectId) => projectId.trim()).filter(Boolean) ?? []
  )
  const selectedProjects =
    requestedIds.size === 0
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

  if (scopedProjects.length === 0) {
    return {
      projects: [],
      tasks: [],
      dependencies: [],
      exceptions: []
    }
  }

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const projectIds = scopedProjects.map((project) => project.id)
  const verifiedProjects = (
    await Promise.all(
      chunkValues(projectIds, 50).map((projectIdChunk) =>
        db
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.organizationId, orgId), inArray(projects.id, projectIdChunk)))
      )
    )
  ).flat()
  const verifiedProjectIds = new Set(verifiedProjects.map((project) => project.id))
  const safeProjectIds = projectIds.filter((projectId) => verifiedProjectIds.has(projectId))

  if (safeProjectIds.length === 0) {
    return {
      projects: [],
      tasks: [],
      dependencies: [],
      exceptions: []
    }
  }

  const [taskChunks, exceptionChunks] = await Promise.all([
    Promise.all(
      chunkValues(safeProjectIds, 50).map((projectIdChunk) =>
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
      chunkValues(safeProjectIds, 50).map((projectIdChunk) =>
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
  const exceptions = exceptionChunks.flat()
  const taskIds = tasks.map((task) => task.id)
  const dependencies = (
    await Promise.all(
      chunkValues(taskIds, 50).map((taskIdChunk) =>
        db.select().from(taskDependencies).where(inArray(taskDependencies.successorId, taskIdChunk))
      )
    )
  ).flat()
  const taskIdSet = new Set(taskIds)

  return {
    projects: scopedProjects.filter((project) => verifiedProjectIds.has(project.id)),
    tasks: tasks.map((task) => {
      const status = task.status as TaskStatus
      return {
        ...task,
        status,
        percentComplete: effectivePercentComplete(status, task.percentComplete)
      }
    }),
    dependencies: dependencies
      .filter(
        (dependency) =>
          taskIdSet.has(dependency.predecessorId) && taskIdSet.has(dependency.successorId)
      )
      .map((dependency) => ({
        ...dependency,
        type: dependency.type as DependencyType
      })),
    exceptions: exceptions.map((exception) => ({
      ...exception,
      type: exception.type as WorkdayExceptionType,
      category: exception.category as ExceptionCategory,
      recurrence: exception.recurrence as ExceptionRecurrence
    }))
  }
}

export async function getScheduleProjects(): Promise<ProjectListItem[]> {
  return schedulePortfolioProjects(await getProjects())
}

export async function importScheduleTemplateItems(
  projectId: string,
  data: {
    readonly templateId: string
    readonly anchorDate: string
    readonly selections: readonly BulkScheduleTemplateSelection[]
  }
): Promise<
  | {
      readonly success: true
      readonly scheduleItemCount: number
      readonly dependencyCount: number
      readonly linkedTodoCount: number
    }
  | { readonly success: false; readonly error: string }
> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "schedule", "update")
    if (!isInternalStaffRole(user.role)) {
      return {
        success: false,
        error: "Template imports are limited to internal project staff."
      }
    }
    if (data.selections.length === 0) {
      return { success: false, error: "Choose at least one schedule item." }
    }

    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const [project, templateVersion] = await Promise.all([
      db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.id, projectId),
            eq(projects.organizationId, organizationId)
          )
        )
        .get(),
      db
        .select({
          templateId: projectTemplates.id,
          templateName: projectTemplates.name,
          versionId: projectTemplateVersions.id
        })
        .from(projectTemplates)
        .innerJoin(
          projectTemplateVersions,
          eq(projectTemplateVersions.templateId, projectTemplates.id)
        )
        .where(
          and(
            eq(projectTemplates.id, data.templateId),
            eq(projectTemplates.organizationId, organizationId),
            eq(projectTemplates.lifecycleStatus, "active"),
            eq(projectTemplates.reviewStatus, "verified"),
            eq(projectTemplateVersions.status, "published"),
            eq(
              projectTemplateVersions.versionNumber,
              projectTemplates.currentVersionNumber
            )
          )
        )
        .get()
    ])
    if (!project) {
      return { success: false, error: "Project not found or access denied" }
    }
    if (!templateVersion) {
      return {
        success: false,
        error: "That published schedule template is no longer available."
      }
    }

    const [templateItems, templateDependencies, templateTodos, exceptions, lastTask] =
      await Promise.all([
        db
          .select()
          .from(scheduleTemplateItems)
          .where(eq(scheduleTemplateItems.versionId, templateVersion.versionId))
          .orderBy(asc(scheduleTemplateItems.sortOrder)),
        db
          .select()
          .from(scheduleTemplateDependencies)
          .where(eq(scheduleTemplateDependencies.versionId, templateVersion.versionId)),
        loadScheduleTemplateTodos(db, templateVersion.versionId),
        fetchExceptions(db, projectId),
        db
          .select({ sortOrder: scheduleTasks.sortOrder })
          .from(scheduleTasks)
          .where(eq(scheduleTasks.projectId, projectId))
          .orderBy(asc(scheduleTasks.sortOrder))
      ])
    const lastSortOrder =
      lastTask.length > 0 ? lastTask[lastTask.length - 1].sortOrder : -1
    const selection = validateBulkScheduleTemplateSelection({
      selections: data.selections,
      availableItemIds: new Set(templateItems.map((item) => item.id)),
      availableTodoIds: new Set(
        templateTodos.map((todo) => todo.templateContentItemId)
      )
    })
    if (!selection.success) return selection

    const selectedItemIds = new Set(selection.data.itemIds)
    const selectedItems = normalizeBulkScheduleTemplateOffsets(
      templateItems.filter((item) => selectedItemIds.has(item.id))
    )
    const selectedDependencies = templateDependencies.filter(
      (dependency) =>
        selectedItemIds.has(dependency.predecessorItemId) &&
        selectedItemIds.has(dependency.successorItemId)
    )
    const existingApplicationItem = await db
      .select({ templateItemId: projectTemplateApplicationItems.templateItemId })
      .from(projectTemplateApplicationItems)
      .innerJoin(
        projectTemplateApplications,
        eq(
          projectTemplateApplications.id,
          projectTemplateApplicationItems.applicationId
        )
      )
      .where(
        and(
          eq(projectTemplateApplications.projectId, projectId),
          eq(projectTemplateApplications.versionId, templateVersion.versionId),
          eq(projectTemplateApplications.anchorDate, data.anchorDate),
          eq(projectTemplateApplications.status, "applied"),
          inArray(projectTemplateApplicationItems.templateItemId, selection.data.itemIds)
        )
      )
      .limit(1)
      .get()
    if (existingApplicationItem) {
      return {
        success: false,
        error:
          "One or more selected schedule items were already imported from this template at that start date."
      }
    }

    const build = buildScheduleTemplateApplication({
      anchorDate: data.anchorDate,
      items: selectedItems,
      dependencies: selectedDependencies,
      exceptions,
      nextId: crypto.randomUUID,
      firstSortOrder: lastSortOrder + 1
    })
    if (!build.success) return build

    const templateTodoById = new Map(
      templateTodos.map((todo) => [todo.templateContentItemId, todo])
    )
    const applicationId = crypto.randomUUID()
    const now = new Date().toISOString()
    const linkedTodoRows = build.data.tasks.flatMap((task) => {
      const selectedTodoIds =
        selection.data.todoIdsByItem.get(task.templateItemId) ?? []
      return selectedTodoIds.flatMap((todoId) => {
        const todo = templateTodoById.get(todoId)
        if (!todo) return []
        return [
          {
            id: crypto.randomUUID(),
            scheduleTaskId: task.id,
            scheduleTaskStartDate: task.startDate,
            scheduleTaskEndDate: task.endDateCalculated,
            todo
          }
        ]
      })
    })
    const statements: D1PreparedStatement[] = [
      env.DB.prepare(
        `INSERT INTO project_template_applications (
          id, organization_id, project_id, template_id, version_id,
          anchor_date, status, applied_by, item_count, dependency_count,
          options_json, created_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'applied', ?, ?, ?, ?, ?, ?)`
      ).bind(
        applicationId,
        organizationId,
        projectId,
        templateVersion.templateId,
        templateVersion.versionId,
        data.anchorDate,
        user.id,
        build.data.tasks.length + linkedTodoRows.length,
        build.data.dependencies.length,
        JSON.stringify({
          mode: "selected_schedule_items",
          scheduleItemCount: build.data.tasks.length,
          linkedTodoCount: linkedTodoRows.length,
          selectedTemplateItemIds: selection.data.itemIds
        }),
        now,
        now
      )
    ]

    for (const task of build.data.tasks) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO schedule_tasks (
            id, project_id, title, start_date, workdays,
            end_date_calculated, phase, display_color, status,
            is_critical_path, is_milestone, percent_complete, assigned_to,
            assigned_user_id, owner_visible, sub_vendor_visible,
            confirmation_required, confirmation_status, sort_order,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, ?, 0, ?, NULL,
            ?, ?, 0, 'not_requested', ?, ?, ?)`
        ).bind(
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
          task.sortOrder,
          now,
          now
        ),
        env.DB.prepare(
          `INSERT INTO project_template_application_items (
            id, application_id, template_item_id, schedule_task_id
          ) VALUES (?, ?, ?, ?)`
        ).bind(
          crypto.randomUUID(),
          applicationId,
          task.templateItemId,
          task.id
        )
      )
    }
    for (const dependency of build.data.dependencies) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO task_dependencies (
            id, predecessor_id, successor_id, type, lag_days
          ) VALUES (?, ?, ?, ?, ?)`
        ).bind(
          dependency.id,
          dependency.predecessorId,
          dependency.successorId,
          dependency.type,
          dependency.lagDays
        )
      )
    }
    for (const linkedTodo of linkedTodoRows) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO project_operations (
            id, project_id, source_system, source_record_type,
            source_record_id, title, description, status, priority,
            assignee_type, start_date, due_date, sage_write_status,
            sage_payload_json, sync_direction, sync_status, created_at,
            updated_at
          ) VALUES (?, ?, 'compass_template', 'schedule_task', ?, ?, ?,
            'open', 'normal', 'internal', ?, ?, 'not_ready', ?, 'write',
            'compass_only', ?, ?)`
        ).bind(
          linkedTodo.id,
          projectId,
          linkedTodo.scheduleTaskId,
          linkedTodo.todo.title,
          linkedTodo.todo.description,
          linkedTodo.scheduleTaskStartDate,
          linkedTodo.scheduleTaskEndDate,
          JSON.stringify({
            source: "project_template_schedule_item",
            templateId: templateVersion.templateId,
            templateName: templateVersion.templateName,
            versionId: templateVersion.versionId,
            templateContentItemId: linkedTodo.todo.templateContentItemId,
            sourceItemId: linkedTodo.todo.sourceItemId,
            checklistItems: linkedTodo.todo.checklistItems
          }),
          now,
          now
        )
      )
    }

    const batchResults = await env.DB.batch(statements)
    if (batchResults.some((result) => !result.success)) {
      throw new Error("Selected template item import batch failed")
    }
    try {
      await recordActivityEvent({
        db,
        organizationId,
        projectId,
        actor: user,
        category: "schedule",
        action: "schedule.template_items_imported",
        entityType: "project_template_application",
        entityId: applicationId,
        summary: `Imported ${build.data.tasks.length} schedule items from “${templateVersion.templateName}”.`,
        metadata: {
          templateId: templateVersion.templateId,
          scheduleItemCount: build.data.tasks.length,
          dependencyCount: build.data.dependencies.length,
          linkedTodoCount: linkedTodoRows.length
        }
      })
    } catch (error) {
      console.error("Unable to record schedule template import activity", error)
    }
    try {
      await recalcCriticalPath(db, projectId)
    } catch (error) {
      console.error("Unable to refresh critical path after schedule template import", error)
    }
    revalidateSchedulePaths(projectId)
    if (linkedTodoRows.length > 0) {
      revalidatePath(`/dashboard/projects/${projectId}/todos`)
      revalidatePath("/dashboard")
    }
    return {
      success: true,
      scheduleItemCount: build.data.tasks.length,
      dependencyCount: build.data.dependencies.length,
      linkedTodoCount: linkedTodoRows.length
    }
  } catch (error) {
    console.error("Failed to import selected schedule template items:", error)
    return {
      success: false,
      error: "Failed to import selected schedule items."
    }
  }
}

export async function createTask(
  projectId: string,
  data: {
    title: string
    startDate: string
    workdays: number
    phase: string
    displayColor?: string
    status?: TaskStatus
    isMilestone?: boolean
    percentComplete?: number
    assignedTo?: string
    assignedOptionId?: string | null
    ownerVisible?: boolean
    subVendorVisible?: boolean
    confirmationRequired?: boolean
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
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "schedule", "update")
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    // verify project belongs to user's org
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
      .limit(1)

    if (!project) {
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

    const exceptions = await fetchExceptions(db, projectId)
    const endDate = calculateEndDate(data.startDate, data.workdays, exceptions)
    const now = new Date().toISOString()

    const existing = await db
      .select({ sortOrder: scheduleTasks.sortOrder })
      .from(scheduleTasks)
      .where(eq(scheduleTasks.projectId, projectId))
      .orderBy(asc(scheduleTasks.sortOrder))

    const nextOrder = existing.length > 0 ? existing[existing.length - 1].sortOrder + 1 : 0

    const id = crypto.randomUUID()
    const assignedUserId = await resolveAssignedUserId(db, orgId, projectId, data.assignedOptionId)
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
      startDate: data.startDate,
      workdays: data.workdays,
      endDateCalculated: endDate,
      phase: data.phase,
      displayColor: data.displayColor ?? "blue",
      status: progress.status,
      isCriticalPath: false,
      isMilestone: data.isMilestone ?? false,
      percentComplete: progress.percentComplete,
      assignedTo: data.assignedTo ?? null,
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

    if (linkedTodoRows.length > 0) {
      // Keep each to-do in its own prepared statement. D1 limits the number of
      // bound values in one statement, so a multi-row insert fails for larger
      // templates even though the surrounding batch is otherwise valid.
      await db.batch([
        db.insert(scheduleTasks).values(scheduleTaskRow),
        ...linkedTodoRows.map((todoRow) => db.insert(projectOperations).values(todoRow))
      ])
    } else {
      await db.insert(scheduleTasks).values(scheduleTaskRow)
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
    revalidateSchedulePaths(projectId)
    if (linkedTodoRows.length > 0) {
      revalidatePath(`/dashboard/projects/${projectId}/todos`)
      revalidatePath("/dashboard")
    }
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
    phase?: string
    displayColor?: string
    status?: TaskStatus
    isMilestone?: boolean
    percentComplete?: number
    assignedTo?: string | null
    assignedOptionId?: string | null
    ownerVisible?: boolean
    subVendorVisible?: boolean
    confirmationRequired?: boolean
    acceptChangeProposal?: boolean
    shiftReason?: string
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "schedule", "update")
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const [task] = await db
      .select()
      .from(scheduleTasks)
      .where(eq(scheduleTasks.id, taskId))
      .limit(1)

    if (!task) return { success: false, error: "Schedule item not found" }

    // verify project belongs to user's org
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, task.projectId), eq(projects.organizationId, orgId)))
      .limit(1)

    if (!project) {
      return { success: false, error: "Access denied" }
    }

    const schedule = await getSchedule(task.projectId)
    const exceptions = schedule.exceptions
    const startDate = data.startDate ?? task.startDate
    const workdays = data.workdays ?? task.workdays
    const endDate = calculateEndDate(startDate, workdays, exceptions)
    const progress = normalizeScheduleProgress(
      (data.status ?? task.status) as TaskStatus,
      data.percentComplete ?? task.percentComplete
    )
    const assignedUserId =
      data.assignedOptionId !== undefined
        ? await resolveAssignedUserId(db, orgId, task.projectId, data.assignedOptionId)
        : data.assignedTo === null
          ? null
          : task.assignedUserId
    const assignmentChanged =
      (data.assignedTo !== undefined && data.assignedTo !== task.assignedTo) ||
      (data.assignedOptionId !== undefined && assignedUserId !== task.assignedUserId)
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
    const dateUpdates = new Map<
      string,
      { readonly startDate: string; readonly endDateCalculated: string }
    >()
    if (scheduleDatesChanged) {
      const { updatedTasks } = propagateDates(
        taskId,
        allTasks,
        schedule.dependencies,
        exceptions
      )
      for (const [updatedTaskId, dates] of updatedTasks) {
        dateUpdates.set(updatedTaskId, dates)
      }
      dateUpdates.set(taskId, {
        startDate,
        endDateCalculated: endDate,
      })
    }
    const shiftSummary = summarizeScheduleShift(schedule.tasks, dateUpdates)
    const shiftReasonResult =
      shiftSummary.affectedItemCount > 0
        ? validateScheduleShiftReason(data.shiftReason)
        : null
    if (shiftReasonResult !== null && !shiftReasonResult.success) {
      return { success: false, error: shiftReasonResult.error }
    }

    // Leave dates untouched until the paired D1 batch below. Linked to-dos
    // must calculate their offsets from the previous schedule dates.
    const taskUpdate = db
      .update(scheduleTasks)
      .set({
        ...(data.title && { title: data.title }),
        workdays,
        ...(data.phase && { phase: data.phase }),
        ...(data.displayColor && { displayColor: data.displayColor }),
        status: progress.status,
        ...(data.isMilestone !== undefined && {
          isMilestone: data.isMilestone
        }),
        percentComplete: progress.percentComplete,
        ...(data.assignedTo !== undefined && {
          assignedTo: data.assignedTo
        }),
        ...(data.assignedOptionId !== undefined || data.assignedTo === null
          ? { assignedUserId }
          : {}),
        ...(data.ownerVisible !== undefined && {
          ownerVisible: data.ownerVisible
        }),
        ...(data.subVendorVisible !== undefined && {
          subVendorVisible: data.subVendorVisible
        }),
        ...(data.confirmationRequired !== undefined && {
          confirmationRequired
        }),
        ...(resetConfirmation
          ? {
              confirmationStatus: confirmation.status,
              confirmationRequestedAt: confirmation.requestedAt,
              confirmationRespondedAt: null,
              reminderSentAt: null,
              proposedStartDate: null,
              proposedWorkdays: null,
              proposalNote: null,
              proposalSubmittedAt: null
            }
          : {}),
        ...(acceptChangeProposal
          ? {
              // The accepted dates remain a draft until the internal user
              // publishes them, at which point the assignee confirms anew.
              confirmationStatus: confirmationRequired ? "pending" : "not_requested",
              confirmationRequestedAt: confirmationRequired ? now : null,
              confirmationRespondedAt: null,
              reminderSentAt: null,
              proposedStartDate: null,
              proposedWorkdays: null,
              proposalNote: null,
              proposalSubmittedAt: null
            }
          : {}),
        updatedAt: now
      })
      .where(eq(scheduleTasks.id, taskId))
    if (assignmentChanged) {
      // Legacy scalar assignment changes invalidate normalized assignees. The
      // child rows carry independent response authority and cannot be left
      // attached to a newly assigned scalar task.
      await db.batch([
        taskUpdate,
        db
          .delete(scheduleTaskAssignees)
          .where(eq(scheduleTaskAssignees.scheduleTaskId, taskId)),
      ])
    } else if (scheduleDatesChanged || resetConfirmation) {
      await db.batch([
        taskUpdate,
        db
          .update(scheduleTaskAssignees)
          .set({
            sourceStartDate: startDate,
            sourceWorkdays: workdays,
            sourceEndDate: endDate,
            responseStatus: "pending",
            dateResponseStatus: "pending",
            durationResponseStatus: "pending",
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
          .where(eq(scheduleTaskAssignees.scheduleTaskId, taskId)),
      ])
    } else {
      await taskUpdate
    }
    await persistScheduleDateUpdates(
      env.DB,
      task.projectId,
      dateUpdates,
      now
    )
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
    revalidateSchedulePaths(task.projectId)
    return { success: true }
  } catch (error) {
    console.error("Failed to update task:", error)
    return { success: false, error: "Failed to update schedule item" }
  }
}

export async function deleteTask(taskId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "schedule", "update")
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const [task] = await db
      .select()
      .from(scheduleTasks)
      .where(eq(scheduleTasks.id, taskId))
      .limit(1)

    if (!task) return { success: false, error: "Schedule item not found" }

    // verify project belongs to user's org
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, task.projectId), eq(projects.organizationId, orgId)))
      .limit(1)

    if (!project) {
      return { success: false, error: "Access denied" }
    }

    await db.delete(scheduleTasks).where(eq(scheduleTasks.id, taskId))
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
    revalidateSchedulePaths(task.projectId)
    return { success: true }
  } catch (error) {
    console.error("Failed to delete task:", error)
    return { success: false, error: "Failed to delete schedule item" }
  }
}

export async function completeScheduleTasks(
  projectId: string,
  taskIds: readonly string[]
): Promise<{ readonly success: true } | { readonly success: false; readonly error: string }> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "schedule", "update")
    const orgId = requireOrg(user)
    const ids = [...new Set(taskIds.map((id) => id.trim()).filter(Boolean))]

    if (ids.length === 0) {
      return { success: false, error: "Select at least one schedule item" }
    }
    if (ids.length > 200) {
      return {
        success: false,
        error: "Update no more than 200 schedule items at a time"
      }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const [project] = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
      .limit(1)

    if (!project) {
      return { success: false, error: "Project not found or access denied" }
    }

    const matchingTasks = await db
      .select({ id: scheduleTasks.id })
      .from(scheduleTasks)
      .where(and(eq(scheduleTasks.projectId, projectId), inArray(scheduleTasks.id, ids)))

    if (matchingTasks.length !== ids.length) {
      return {
        success: false,
        error: "One or more schedule items could not be found"
      }
    }

    await db
      .update(scheduleTasks)
      .set({
        status: "COMPLETE",
        percentComplete: 100,
        updatedAt: new Date().toISOString()
      })
      .where(and(eq(scheduleTasks.projectId, projectId), inArray(scheduleTasks.id, ids)))

    await recordActivityEvent({
      db,
      organizationId: orgId,
      projectId,
      actor: user,
      category: "schedule",
      action: "schedule.items_completed",
      entityType: "schedule_item_batch",
      summary: `Marked ${ids.length} schedule ${ids.length === 1 ? "item" : "items"} complete.`,
      metadata: { itemCount: ids.length }
    })
    await recalcCriticalPath(db, projectId)
    revalidateSchedulePaths(projectId)
    return { success: true }
  } catch (error) {
    console.error("Failed to complete schedule items:", error)
    return { success: false, error: "Failed to complete schedule items" }
  }
}

export async function assignScheduleTasks(
  projectId: string,
  taskIds: readonly string[],
  assignedTo: string | null
): Promise<{ readonly success: true } | { readonly success: false; readonly error: string }> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "schedule", "update")
    const orgId = requireOrg(user)
    const ids = [...new Set(taskIds.map((id) => id.trim()).filter(Boolean))]

    if (ids.length === 0) {
      return { success: false, error: "Select at least one schedule item" }
    }
    if (ids.length > 200) {
      return {
        success: false,
        error: "Update no more than 200 schedule items at a time"
      }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const [project] = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
      .limit(1)

    if (!project) {
      return { success: false, error: "Project not found or access denied" }
    }

    const matchingTasks = await db
      .select({
        id: scheduleTasks.id,
        confirmationRequired: scheduleTasks.confirmationRequired
      })
      .from(scheduleTasks)
      .where(and(eq(scheduleTasks.projectId, projectId), inArray(scheduleTasks.id, ids)))

    if (matchingTasks.length !== ids.length) {
      return {
        success: false,
        error: "One or more schedule items could not be found"
      }
    }

    const now = new Date().toISOString()
    // Pair each legacy scalar update with removal of its normalized assignees.
    // Chunking keeps every atomic D1 batch below the statement ceiling.
    for (const taskChunk of chunkValues(matchingTasks, 40)) {
      const [firstStatement, ...remainingStatements] = taskChunk.flatMap((task) => [
          db
            .delete(scheduleTaskAssignees)
            .where(eq(scheduleTaskAssignees.scheduleTaskId, task.id)),
          db
            .update(scheduleTasks)
            .set({
              assignedTo: assignedTo?.trim() || null,
              assignedUserId: null,
              confirmationStatus: task.confirmationRequired ? "unavailable" : "not_requested",
              confirmationRequestedAt: task.confirmationRequired ? now : null,
              confirmationRespondedAt: null,
              reminderSentAt: null,
              updatedAt: now
            })
            .where(and(eq(scheduleTasks.id, task.id), eq(scheduleTasks.projectId, projectId)))
        ])
      if (!firstStatement) continue
      await db.batch([firstStatement, ...remainingStatements])
    }

    await recordActivityEvent({
      db,
      organizationId: orgId,
      projectId,
      actor: user,
      category: "schedule",
      action: "schedule.items_assigned",
      entityType: "schedule_item_batch",
      summary: assignedTo?.trim()
        ? `Assigned ${ids.length} schedule ${ids.length === 1 ? "item" : "items"} to ${assignedTo.trim()}.`
        : `Cleared the assignee from ${ids.length} schedule ${ids.length === 1 ? "item" : "items"}.`,
      metadata: { itemCount: ids.length }
    })
    revalidateSchedulePaths(projectId)
    return { success: true }
  } catch (error) {
    console.error("Failed to assign schedule items:", error)
    return { success: false, error: "Failed to assign schedule items" }
  }
}

export async function deleteScheduleTasks(
  projectId: string,
  taskIds: readonly string[]
): Promise<{ readonly success: true } | { readonly success: false; readonly error: string }> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "schedule", "update")
    const orgId = requireOrg(user)
    const ids = [...new Set(taskIds.map((id) => id.trim()).filter(Boolean))]

    if (ids.length === 0) {
      return { success: false, error: "Select at least one schedule item" }
    }
    if (ids.length > 200) {
      return {
        success: false,
        error: "Delete no more than 200 schedule items at a time"
      }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const [project] = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
      .limit(1)

    if (!project) {
      return { success: false, error: "Project not found or access denied" }
    }

    const matchingTasks = await db
      .select({ id: scheduleTasks.id })
      .from(scheduleTasks)
      .where(and(eq(scheduleTasks.projectId, projectId), inArray(scheduleTasks.id, ids)))

    if (matchingTasks.length !== ids.length) {
      return {
        success: false,
        error: "One or more schedule items could not be found"
      }
    }

    await db
      .delete(scheduleTasks)
      .where(and(eq(scheduleTasks.projectId, projectId), inArray(scheduleTasks.id, ids)))

    await recordActivityEvent({
      db,
      organizationId: orgId,
      projectId,
      actor: user,
      category: "schedule",
      action: "schedule.items_deleted",
      entityType: "schedule_item_batch",
      summary: `Deleted ${ids.length} schedule ${ids.length === 1 ? "item" : "items"}.`,
      metadata: { itemCount: ids.length }
    })
    await recalcCriticalPath(db, projectId)
    revalidateSchedulePaths(projectId)
    return { success: true }
  } catch (error) {
    console.error("Failed to delete schedule items:", error)
    return { success: false, error: "Failed to delete schedule items" }
  }
}

export async function reorderTasks(
  projectId: string,
  items: { id: string; sortOrder: number }[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "schedule", "update")
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    // verify project belongs to user's org
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
      .limit(1)

    if (!project) {
      return { success: false, error: "Project not found or access denied" }
    }

    const uniqueItems = [
      ...new Map(
        items.filter((item) => item.id.trim().length > 0).map((item) => [item.id, item])
      ).values()
    ]
    if (uniqueItems.length === 0) {
      return { success: false, error: "Select schedule items to reorder" }
    }
    if (uniqueItems.length > 500) {
      return {
        success: false,
        error: "Reorder no more than 500 schedule items at a time"
      }
    }
    const matchingTasks = await db
      .select({ id: scheduleTasks.id })
      .from(scheduleTasks)
      .where(
        and(
          eq(scheduleTasks.projectId, projectId),
          inArray(
            scheduleTasks.id,
            uniqueItems.map((item) => item.id)
          )
        )
      )
    if (matchingTasks.length !== uniqueItems.length) {
      return {
        success: false,
        error: "One or more schedule items do not belong to this project"
      }
    }

    for (const item of uniqueItems) {
      await db
        .update(scheduleTasks)
        .set({ sortOrder: item.sortOrder })
        .where(and(eq(scheduleTasks.id, item.id), eq(scheduleTasks.projectId, projectId)))
    }

    await recordActivityEvent({
      db,
      organizationId: orgId,
      projectId,
      actor: user,
      category: "schedule",
      action: "schedule.items_reordered",
      entityType: "project_schedule",
      entityId: projectId,
      summary: `Reordered ${uniqueItems.length} schedule ${uniqueItems.length === 1 ? "item" : "items"}.`,
      metadata: { itemCount: uniqueItems.length }
    })
    revalidateSchedulePaths(projectId)
    return { success: true }
  } catch (error) {
    console.error("Failed to reorder tasks:", error)
    return { success: false, error: "Failed to reorder schedule items" }
  }
}

export async function createDependency(data: {
  predecessorId: string
  successorId: string
  type: DependencyType
  lagDays: number
  projectId: string
  shiftReason: string
}): Promise<{ readonly success: true } | { readonly success: false; readonly error: string }> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "schedule", "update")
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    // verify project belongs to user's org
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, data.projectId), eq(projects.organizationId, orgId)))
      .limit(1)

    if (!project) {
      return { success: false, error: "Project not found or access denied" }
    }
    const shiftReasonResult = validateScheduleShiftReason(data.shiftReason)
    if (!shiftReasonResult.success) {
      return { success: false, error: shiftReasonResult.error }
    }

    if (data.predecessorId === data.successorId) {
      return {
        success: false,
        error: "A schedule item cannot depend on itself"
      }
    }

    const [predecessor] = await db
      .select({ projectId: scheduleTasks.projectId })
      .from(scheduleTasks)
      .where(eq(scheduleTasks.id, data.predecessorId))
      .limit(1)
    const [successor] = await db
      .select({ projectId: scheduleTasks.projectId })
      .from(scheduleTasks)
      .where(eq(scheduleTasks.id, data.successorId))
      .limit(1)

    if (
      !predecessor ||
      !successor ||
      predecessor.projectId !== data.projectId ||
      successor.projectId !== data.projectId
    ) {
      return {
        success: false,
        error: "Both schedule items must belong to this project"
      }
    }

    const [duplicate] = await db
      .select({ id: taskDependencies.id })
      .from(taskDependencies)
      .where(
        and(
          eq(taskDependencies.predecessorId, data.predecessorId),
          eq(taskDependencies.successorId, data.successorId)
        )
      )
      .limit(1)

    if (duplicate) {
      return {
        success: false,
        error: "That dependency already exists"
      }
    }

    // get existing deps for cycle check
    const schedule = await getSchedule(data.projectId)

    if (wouldCreateCycle(schedule.dependencies, data.predecessorId, data.successorId)) {
      return { success: false, error: "This dependency would create a cycle" }
    }

    const dependencyId = crypto.randomUUID()
    await db.insert(taskDependencies).values({
      id: dependencyId,
      predecessorId: data.predecessorId,
      successorId: data.successorId,
      type: data.type,
      lagDays: data.lagDays
    })

    // propagate dates from predecessor
    const updatedSchedule = await getSchedule(data.projectId)
    const { updatedTasks } = propagateDates(
      data.predecessorId,
      updatedSchedule.tasks,
      updatedSchedule.dependencies,
      updatedSchedule.exceptions
    )
    const shiftSummary = summarizeScheduleShift(schedule.tasks, updatedTasks)
    await persistScheduleDateUpdates(
      env.DB,
      data.projectId,
      updatedTasks,
      new Date().toISOString()
    )
    await recordScheduleShift({
      db,
      organizationId: orgId,
      projectId: data.projectId,
      actor: user,
      sourceType: "schedule_dependency",
      sourceId: dependencyId,
      sourceLabel: "a new dependency",
      reason: shiftReasonResult.reason,
      summary: shiftSummary,
    })

    await recordActivityEvent({
      db,
      organizationId: orgId,
      projectId: data.projectId,
      actor: user,
      category: "schedule",
      action: "schedule.dependency_created",
      entityType: "schedule_dependency",
      summary: "Added a schedule dependency.",
      metadata: {
        affectedItemCount: updatedTasks.size,
        relationship: data.type,
        lagDays: data.lagDays
      }
    })
    await recalcCriticalPath(db, data.projectId)
    revalidateSchedulePaths(data.projectId)
    return { success: true }
  } catch (error) {
    console.error("Failed to create dependency:", error)
    return { success: false, error: "Failed to create dependency" }
  }
}

export async function updateDependency(data: {
  dependencyId: string
  predecessorId: string
  successorId: string
  type: DependencyType
  lagDays: number
  projectId: string
  shiftReason: string
}): Promise<{ readonly success: true } | { readonly success: false; readonly error: string }> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "schedule", "update")
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, data.projectId), eq(projects.organizationId, orgId)))
      .limit(1)

    if (!project) {
      return { success: false, error: "Project not found or access denied" }
    }
    const shiftReasonResult = validateScheduleShiftReason(data.shiftReason)
    if (!shiftReasonResult.success) {
      return { success: false, error: shiftReasonResult.error }
    }
    if (data.predecessorId === data.successorId) {
      return {
        success: false,
        error: "A schedule item cannot depend on itself"
      }
    }

    const schedule = await getSchedule(data.projectId)
    const taskIds = new Set(schedule.tasks.map((task) => task.id))
    const currentDependency = schedule.dependencies.find(
      (dependency) => dependency.id === data.dependencyId
    )

    if (!currentDependency) {
      return { success: false, error: "Dependency not found" }
    }
    if (!taskIds.has(data.predecessorId) || !taskIds.has(data.successorId)) {
      return {
        success: false,
        error: "Both schedule items must belong to this project"
      }
    }

    const otherDependencies = schedule.dependencies.filter(
      (dependency) => dependency.id !== data.dependencyId
    )
    if (
      otherDependencies.some(
        (dependency) =>
          dependency.predecessorId === data.predecessorId &&
          dependency.successorId === data.successorId
      )
    ) {
      return { success: false, error: "That dependency already exists" }
    }
    if (
      wouldDependencyUpdateCreateCycle(
        schedule.dependencies,
        data.dependencyId,
        data.predecessorId,
        data.successorId
      )
    ) {
      return { success: false, error: "This dependency would create a cycle" }
    }

    const updatedDependency = {
      id: data.dependencyId,
      predecessorId: data.predecessorId,
      successorId: data.successorId,
      type: data.type,
      lagDays: data.lagDays
    }
    const recalculated = propagateDates(
      data.predecessorId,
      schedule.tasks,
      [...otherDependencies, updatedDependency],
      schedule.exceptions
    )
    const shiftSummary = summarizeScheduleShift(
      schedule.tasks,
      recalculated.updatedTasks
    )
    const updatedAt = new Date().toISOString()
    const statements: D1PreparedStatement[] = [
      env.DB.prepare(
        `UPDATE task_dependencies
         SET predecessor_id = ?, successor_id = ?, type = ?, lag_days = ?
         WHERE id = ?`
      ).bind(data.predecessorId, data.successorId, data.type, data.lagDays, data.dependencyId)
    ]

    for (const [taskId, dates] of recalculated.updatedTasks) {
      statements.push(
        linkedTodoDateUpdateStatement(env.DB, {
          scheduleTaskId: taskId,
          nextStartDate: dates.startDate,
          nextEndDate: dates.endDateCalculated,
          updatedAt,
        }),
        env.DB.prepare(
          `UPDATE schedule_tasks
           SET start_date = ?, end_date_calculated = ?, updated_at = ?
           WHERE id = ? AND project_id = ?`
        ).bind(dates.startDate, dates.endDateCalculated, updatedAt, taskId, data.projectId)
      )
    }

    const results = await env.DB.batch(statements)
    if (results.some((result) => !result.success)) {
      throw new Error("Dependency update batch failed")
    }
    await recordScheduleShift({
      db,
      organizationId: orgId,
      projectId: data.projectId,
      actor: user,
      sourceType: "schedule_dependency",
      sourceId: data.dependencyId,
      sourceLabel: "an updated dependency",
      reason: shiftReasonResult.reason,
      summary: shiftSummary,
    })

    await recordActivityEvent({
      db,
      organizationId: orgId,
      projectId: data.projectId,
      actor: user,
      category: "schedule",
      action: "schedule.dependency_updated",
      entityType: "schedule_dependency",
      entityId: data.dependencyId,
      summary: "Updated a schedule dependency.",
      metadata: {
        affectedItemCount: recalculated.updatedTasks.size,
        relationship: data.type,
        lagDays: data.lagDays
      }
    })
    await recalcCriticalPath(db, data.projectId)
    revalidateSchedulePaths(data.projectId)
    return { success: true }
  } catch (error) {
    console.error("Failed to update dependency:", error)
    return { success: false, error: "Failed to update dependency" }
  }
}

export async function deleteDependency(
  depId: string,
  projectId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "schedule", "update")
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    // verify project belongs to user's org
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
      .limit(1)

    if (!project) {
      return { success: false, error: "Project not found or access denied" }
    }

    const [dependency] = await db
      .select()
      .from(taskDependencies)
      .where(eq(taskDependencies.id, depId))
      .limit(1)

    if (!dependency) {
      return { success: false, error: "Dependency not found" }
    }

    const taskIds = new Set(
      (
        await db
          .select({ id: scheduleTasks.id })
          .from(scheduleTasks)
          .where(eq(scheduleTasks.projectId, projectId))
      ).map((task) => task.id)
    )
    if (!taskIds.has(dependency.predecessorId) || !taskIds.has(dependency.successorId)) {
      return {
        success: false,
        error: "Dependency does not belong to this project"
      }
    }

    await db.delete(taskDependencies).where(eq(taskDependencies.id, depId))
    await recordActivityEvent({
      db,
      organizationId: orgId,
      projectId,
      actor: user,
      category: "schedule",
      action: "schedule.dependency_deleted",
      entityType: "schedule_dependency",
      entityId: depId,
      summary: "Removed a schedule dependency."
    })
    await recalcCriticalPath(db, projectId)
    revalidateSchedulePaths(projectId)
    return { success: true }
  } catch (error) {
    console.error("Failed to delete dependency:", error)
    return { success: false, error: "Failed to delete dependency" }
  }
}

export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "schedule", "update")
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const [task] = await db
      .select()
      .from(scheduleTasks)
      .where(eq(scheduleTasks.id, taskId))
      .limit(1)

    if (!task) return { success: false, error: "Schedule item not found" }

    // verify project belongs to user's org
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, task.projectId), eq(projects.organizationId, orgId)))
      .limit(1)

    if (!project) {
      return { success: false, error: "Access denied" }
    }

    await db
      .update(scheduleTasks)
      .set({
        status,
        percentComplete: effectivePercentComplete(status, task.percentComplete),
        updatedAt: new Date().toISOString()
      })
      .where(eq(scheduleTasks.id, taskId))

    await recordActivityEvent({
      db,
      organizationId: orgId,
      projectId: task.projectId,
      actor: user,
      category: "schedule",
      action: "schedule.item_status_changed",
      entityType: "schedule_item",
      entityId: taskId,
      summary: `Changed “${task.title}” to ${status.toLowerCase().replace("_", " ")}.`,
      metadata: { status }
    })
    revalidateSchedulePaths(task.projectId)
    return { success: true }
  } catch (error) {
    console.error("Failed to update task status:", error)
    return { success: false, error: "Failed to update status" }
  }
}

// recalculates critical path and updates all tasks
async function recalcCriticalPath(db: ReturnType<typeof getDb>, projectId: string) {
  const tasks = await db.select().from(scheduleTasks).where(eq(scheduleTasks.projectId, projectId))

  const deps = await db.select().from(taskDependencies)
  const taskIds = new Set(tasks.map((t) => t.id))
  const projectDeps = deps.filter((d) => taskIds.has(d.predecessorId) && taskIds.has(d.successorId))

  const criticalSet = findCriticalPath(
    tasks.map((t) => ({ ...t, status: t.status as TaskStatus })),
    projectDeps.map((d) => ({ ...d, type: d.type as DependencyType }))
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
