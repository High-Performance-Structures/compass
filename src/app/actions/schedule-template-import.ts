"use server"

import { and, asc, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import {
  projectTemplateApplicationItems,
  projectTemplateApplications,
  projectTemplates,
  projectTemplateVersions,
  scheduleTemplateDependencies,
  scheduleTemplateItems
} from "@/db/schema-templates"
import { recordActivityEvent } from "@/lib/activity-log"
import { scheduleWriteContext } from "@/lib/domain/schedule/access"
import {
  isOrganizationProject,
  loadProjectExceptions,
  nextProjectSortOrder
} from "@/lib/domain/schedule/queries"
import { schedulePaths } from "@/lib/domain/schedule/rules"
import {
  dependencyInsertStatement,
  recalcCriticalPath,
  templateTaskInsertStatement
} from "@/lib/domain/schedule/store"
import { loadScheduleTemplateTodos } from "@/lib/domain/schedule/template-items"
import { buildScheduleTemplateApplication } from "@/lib/templates/schedule-template-application"
import {
  normalizeBulkScheduleTemplateOffsets,
  validateBulkScheduleTemplateSelection,
  type BulkScheduleTemplateSelection
} from "@/lib/templates/schedule-template-bulk-selection"
import { isInternalStaffRole } from "@/lib/user-roles"

/*
 * Imports selected items of a published schedule template. The application,
 * application-item, and linked to-do rows (other modules' tables) are written
 * in the same atomic D1 batch as the schedule rows, with their SQL unchanged.
 */
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
    const context = await scheduleWriteContext()
    if (!context.success) return context
    const { db, env, organizationId, user } = context.data
    if (!isInternalStaffRole(user.role)) {
      return {
        success: false,
        error: "Template imports are limited to internal project staff."
      }
    }
    if (data.selections.length === 0) {
      return { success: false, error: "Choose at least one schedule item." }
    }

    const [projectFound, templateVersion] = await Promise.all([
      isOrganizationProject(db, organizationId, projectId),
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
    if (!projectFound) {
      return { success: false, error: "Project not found or access denied" }
    }
    if (!templateVersion) {
      return {
        success: false,
        error: "That published schedule template is no longer available."
      }
    }

    const [templateItems, templateDependencies, templateTodos, exceptions, firstSortOrder] =
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
        loadProjectExceptions(db, projectId),
        nextProjectSortOrder(db, projectId)
      ])
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
      firstSortOrder
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
        templateTaskInsertStatement(env.DB, projectId, task, now, task.notes),
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
      statements.push(dependencyInsertStatement(env.DB, dependency))
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
    for (const path of schedulePaths(projectId)) revalidatePath(path)
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
