"use server"

import { and, asc, desc, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getCloudflareContext } from "@/lib/db"
import { getDb } from "@/db"
import {
  projects,
  scheduleTasks,
  taskDependencies,
  workdayExceptions,
} from "@/db/schema"
import {
  projectTemplateApplications,
  projectTemplateContentItems,
  projectTemplateModules,
  projectTemplates,
  projectTemplateVersions,
  scheduleTemplateDependencies,
  scheduleTemplateItems,
} from "@/db/schema-templates"
import { requireAuth } from "@/lib/auth"
import { requireOrg } from "@/lib/org-scope"
import { requirePermission } from "@/lib/permissions"
import { isDemoUser } from "@/lib/demo"
import { isInternalStaffRole } from "@/lib/user-roles"
import { recordActivityEvent } from "@/lib/activity-log"
import { findCriticalPath } from "@/lib/schedule/critical-path"
import type {
  DependencyType,
  ExceptionCategory,
  ExceptionRecurrence,
  TaskStatus,
  WorkdayExceptionData,
  WorkdayExceptionType,
} from "@/lib/schedule/types"
import { buildProjectTemplateContentApplication } from "@/lib/templates/project-template-content-application"
import { buildScheduleTemplateApplication } from "@/lib/templates/schedule-template-application"

export type ProjectTemplateLibraryItem = {
  readonly id: string
  readonly name: string
  readonly description: string | null
  readonly sourceSystem: string
  readonly templateKind: string
  readonly departmentCode: string | null
  readonly tradeCategory: string | null
  readonly lifecycleStatus: string
  readonly reviewStatus: string
  readonly currentVersionNumber: number | null
  readonly currentVersionId: string | null
  readonly currentVersionStatus: string | null
  readonly scheduleItemCount: number
  readonly dependencyCount: number
  readonly modules: readonly ProjectTemplateModuleSummary[]
}

export type ProjectTemplateContentItem = {
  readonly id: string
  readonly moduleType: string
  readonly sourceItemId: string | null
  readonly parentSourceItemId: string | null
  readonly title: string
  readonly category: string | null
  readonly description: string | null
  readonly sortOrder: number
  readonly payloadJson: string | null
}

export type ProjectTemplateModuleSummary = {
  readonly moduleType: string
  readonly sourceItemCount: number
  readonly normalizationStatus: string
}

export type ProjectTemplatePreview = ProjectTemplateLibraryItem & {
  readonly scheduleItems: readonly {
    readonly title: string
    readonly workdays: number
    readonly startOffsetWorkdays: number
    readonly phase: string
    readonly assigneePlaceholder: string | null
  }[]
  readonly assigneePlaceholders: readonly string[]
}

type ActionResult =
  | { readonly success: true }
  | { readonly success: false; readonly error: string }

function ensureInternalUser(role: string): void {
  if (!isInternalStaffRole(role)) {
    throw new Error("Template management is limited to internal staff.")
  }
}

function taskStatus(value: string): TaskStatus {
  switch (value) {
    case "IN_PROGRESS":
    case "COMPLETE":
    case "BLOCKED":
      return value
    default:
      return "PENDING"
  }
}

function dependencyType(value: string): DependencyType {
  switch (value) {
    case "SS":
    case "FF":
    case "SF":
      return value
    default:
      return "FS"
  }
}

function exceptionType(value: string): WorkdayExceptionType {
  return value === "working" ? "working" : "non_working"
}

function exceptionCategory(value: string): ExceptionCategory {
  switch (value) {
    case "national_holiday":
    case "state_holiday":
    case "vacation_day":
    case "company_holiday":
    case "weather_day":
    case "extra_workday":
      return value
    default:
      return "company_holiday"
  }
}

function exceptionRecurrence(value: string): ExceptionRecurrence {
  return value === "yearly" ? "yearly" : "one_time"
}

function exceptionData(
  row: typeof workdayExceptions.$inferSelect
): WorkdayExceptionData {
  return {
    ...row,
    type: exceptionType(row.type),
    category: exceptionCategory(row.category),
    recurrence: exceptionRecurrence(row.recurrence),
  }
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

async function recalculateCriticalPath(
  db: ReturnType<typeof getDb>,
  projectId: string
): Promise<void> {
  const tasks = await db
    .select()
    .from(scheduleTasks)
    .where(eq(scheduleTasks.projectId, projectId))
  const taskIds = new Set(tasks.map((task) => task.id))
  const dependencies = (await db.select().from(taskDependencies)).filter(
    (dependency) =>
      taskIds.has(dependency.predecessorId) &&
      taskIds.has(dependency.successorId)
  )
  const criticalIds = findCriticalPath(
    tasks.map((task) => ({ ...task, status: taskStatus(task.status) })),
    dependencies.map((dependency) => ({
      ...dependency,
      type: dependencyType(dependency.type),
    }))
  )

  for (const task of tasks) {
    const isCriticalPath = criticalIds.has(task.id)
    if (task.isCriticalPath === isCriticalPath) continue
    await db
      .update(scheduleTasks)
      .set({ isCriticalPath })
      .where(eq(scheduleTasks.id, task.id))
  }
}

export async function getProjectTemplateLibrary(): Promise<
  readonly ProjectTemplateLibraryItem[]
> {
  const user = await requireAuth()
  requirePermission(user, "schedule", "read")
  ensureInternalUser(user.role)
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  const templates = await db
    .select()
    .from(projectTemplates)
    .where(eq(projectTemplates.organizationId, organizationId))
    .orderBy(asc(projectTemplates.tradeCategory), asc(projectTemplates.name))
  if (templates.length === 0) return []

  const templateIds = templates.map((template) => template.id)
  const versions = await db
    .select()
    .from(projectTemplateVersions)
    .where(inArray(projectTemplateVersions.templateId, templateIds))
  const versionByTemplateAndNumber = new Map(
    versions.map((version) => [
      `${version.templateId}:${version.versionNumber}`,
      version,
    ])
  )
  const currentVersionIds = templates.flatMap((template) => {
    if (template.currentVersionNumber === null) return []
    const version = versionByTemplateAndNumber.get(
      `${template.id}:${template.currentVersionNumber}`
    )
    return version ? [version.id] : []
  })
  const items = currentVersionIds.length
    ? await db
        .select()
        .from(scheduleTemplateItems)
        .where(inArray(scheduleTemplateItems.versionId, currentVersionIds))
    : []
  const dependencies = currentVersionIds.length
    ? await db
        .select()
        .from(scheduleTemplateDependencies)
        .where(
          inArray(scheduleTemplateDependencies.versionId, currentVersionIds)
        )
    : []
  const modules = currentVersionIds.length
    ? await db
        .select()
        .from(projectTemplateModules)
        .where(inArray(projectTemplateModules.versionId, currentVersionIds))
    : []

  return templates.map((template): ProjectTemplateLibraryItem => {
    const version =
      template.currentVersionNumber === null
        ? null
        : versionByTemplateAndNumber.get(
            `${template.id}:${template.currentVersionNumber}`
          ) ?? null
    return {
      id: template.id,
      name: template.name,
      description: template.description,
      sourceSystem: template.sourceSystem,
      templateKind: template.templateKind,
      departmentCode: template.departmentCode,
      tradeCategory: template.tradeCategory,
      lifecycleStatus: template.lifecycleStatus,
      reviewStatus: template.reviewStatus,
      currentVersionNumber: template.currentVersionNumber,
      currentVersionId: version?.id ?? null,
      currentVersionStatus: version?.status ?? null,
      scheduleItemCount: version
        ? items.filter((item) => item.versionId === version.id).length
        : 0,
      dependencyCount: version
        ? dependencies.filter(
            (dependency) => dependency.versionId === version.id
          ).length
        : 0,
      modules: version
        ? modules
            .filter((module) => module.versionId === version.id)
            .map((module) => ({
              moduleType: module.moduleType,
              sourceItemCount: module.sourceItemCount,
              normalizationStatus: module.normalizationStatus,
            }))
        : [],
    }
  })
}

export async function getProjectTemplateContent(
  templateId: string
): Promise<readonly ProjectTemplateContentItem[]> {
  const library = await getProjectTemplateLibrary()
  const template = library.find((candidate) => candidate.id === templateId)
  if (!template?.currentVersionId) return []

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  return db
    .select({
      id: projectTemplateContentItems.id,
      moduleType: projectTemplateContentItems.moduleType,
      sourceItemId: projectTemplateContentItems.sourceItemId,
      parentSourceItemId: projectTemplateContentItems.parentSourceItemId,
      title: projectTemplateContentItems.title,
      category: projectTemplateContentItems.category,
      description: projectTemplateContentItems.description,
      sortOrder: projectTemplateContentItems.sortOrder,
      payloadJson: projectTemplateContentItems.payloadJson,
    })
    .from(projectTemplateContentItems)
    .where(eq(projectTemplateContentItems.versionId, template.currentVersionId))
    .orderBy(
      asc(projectTemplateContentItems.moduleType),
      asc(projectTemplateContentItems.sortOrder)
    )
}

export async function getProjectTemplatePreview(
  templateId: string
): Promise<ProjectTemplatePreview | null> {
  const library = await getProjectTemplateLibrary()
  const template = library.find((candidate) => candidate.id === templateId)
  if (!template?.currentVersionId) return template ? { ...template, scheduleItems: [], assigneePlaceholders: [] } : null

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const scheduleItems = await db
    .select()
    .from(scheduleTemplateItems)
    .where(eq(scheduleTemplateItems.versionId, template.currentVersionId))
    .orderBy(asc(scheduleTemplateItems.sortOrder))
  const assigneePlaceholders = [
    ...new Set(
      scheduleItems.flatMap((item) =>
        item.assigneePlaceholder ? [item.assigneePlaceholder] : []
      )
    ),
  ].sort((left, right) => left.localeCompare(right))

  return {
    ...template,
    scheduleItems: scheduleItems.map((item) => ({
      title: item.title,
      workdays: item.workdays,
      startOffsetWorkdays: item.startOffsetWorkdays,
      phase: item.phase,
      assigneePlaceholder: item.assigneePlaceholder,
    })),
    assigneePlaceholders,
  }
}

export async function applyProjectTemplate(input: {
  readonly projectId: string
  readonly templateId: string
  readonly anchorDate: string
}): Promise<
  | {
      readonly success: true
      readonly applicationId: string
      readonly itemCount: number
      readonly dependencyCount: number
      readonly scheduleItemCount: number
      readonly taskCount: number
      readonly selectionCount: number
      readonly bidPackageCount: number
    }
  | { readonly success: false; readonly error: string }
> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "schedule", "update")
    ensureInternalUser(user.role)
    const organizationId = requireOrg(user)
    if (!isIsoDate(input.anchorDate)) {
      return { success: false, error: "Choose a valid template start date." }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const project = await db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.id, input.projectId),
          eq(projects.organizationId, organizationId)
        )
      )
      .get()
    if (!project) {
      return { success: false, error: "Project not found or access denied." }
    }

    const template = await db
      .select()
      .from(projectTemplates)
      .where(
        and(
          eq(projectTemplates.id, input.templateId),
          eq(projectTemplates.organizationId, organizationId)
        )
      )
      .get()
    if (
      !template ||
      template.lifecycleStatus !== "active" ||
      template.reviewStatus !== "verified" ||
      template.currentVersionNumber === null
    ) {
      return {
        success: false,
        error: "This template is not verified and ready to apply.",
      }
    }

    const version = await db
      .select()
      .from(projectTemplateVersions)
      .where(
        and(
          eq(projectTemplateVersions.templateId, template.id),
          eq(
            projectTemplateVersions.versionNumber,
            template.currentVersionNumber
          ),
          eq(projectTemplateVersions.status, "published")
        )
      )
      .get()
    if (!version) {
      return { success: false, error: "The template has no published version." }
    }

    const previousApplication = await db
      .select({ id: projectTemplateApplications.id })
      .from(projectTemplateApplications)
      .where(
        and(
          eq(projectTemplateApplications.projectId, input.projectId),
          eq(projectTemplateApplications.versionId, version.id),
          eq(projectTemplateApplications.anchorDate, input.anchorDate),
          eq(projectTemplateApplications.status, "applied")
        )
      )
      .get()
    if (previousApplication) {
      return {
        success: false,
        error: "This template version was already applied at that start date.",
      }
    }

    const [
      templateItems,
      templateDependencies,
      templateContentItems,
      exceptionRows,
      lastTask,
    ] =
      await Promise.all([
        db
          .select()
          .from(scheduleTemplateItems)
          .where(eq(scheduleTemplateItems.versionId, version.id))
          .orderBy(asc(scheduleTemplateItems.sortOrder)),
        db
          .select()
          .from(scheduleTemplateDependencies)
          .where(eq(scheduleTemplateDependencies.versionId, version.id)),
        db
          .select()
          .from(projectTemplateContentItems)
          .where(eq(projectTemplateContentItems.versionId, version.id))
          .orderBy(
            asc(projectTemplateContentItems.moduleType),
            asc(projectTemplateContentItems.sortOrder)
          ),
        db
          .select()
          .from(workdayExceptions)
          .where(eq(workdayExceptions.projectId, input.projectId)),
        db
          .select({ sortOrder: scheduleTasks.sortOrder })
          .from(scheduleTasks)
          .where(eq(scheduleTasks.projectId, input.projectId))
          .orderBy(desc(scheduleTasks.sortOrder))
          .limit(1)
          .then((rows) => rows[0] ?? null),
      ])
    const build = buildScheduleTemplateApplication({
      anchorDate: input.anchorDate,
      items: templateItems,
      dependencies: templateDependencies,
      exceptions: exceptionRows.map(exceptionData),
      nextId: crypto.randomUUID,
      firstSortOrder: (lastTask?.sortOrder ?? -1) + 1,
    })
    if (!build.success) return build

    const applicationId = crypto.randomUUID()
    const now = new Date().toISOString()
    const contentBuild = buildProjectTemplateContentApplication({
      applicationId,
      items: templateContentItems,
      nextId: crypto.randomUUID,
    })
    const contentItemCount =
      contentBuild.todos.length +
      contentBuild.selections.length +
      contentBuild.bidPackages.length
    const totalItemCount = build.data.tasks.length + contentItemCount
    // Keep every project record in the same D1 batch so a malformed module
    // cannot leave a partially applied setup behind.
    const statements: D1PreparedStatement[] = [
      env.DB.prepare(
        `INSERT INTO project_template_applications (
          id, organization_id, project_id, template_id, version_id,
          anchor_date, status, applied_by, item_count, dependency_count,
          options_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'applying', ?, ?, ?, ?, ?)`
      ).bind(
        applicationId,
        organizationId,
        input.projectId,
        template.id,
        version.id,
        input.anchorDate,
        user.id,
        totalItemCount,
        build.data.dependencies.length,
        JSON.stringify({
          assignmentMode: "preserve_placeholders",
          scheduleItemCount: build.data.tasks.length,
          taskCount: contentBuild.todos.length,
          selectionCount: contentBuild.selections.length,
          bidPackageCount: contentBuild.bidPackages.length,
        }),
        now
      ),
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
          input.projectId,
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
        )
      )
      statements.push(
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
    for (const todo of contentBuild.todos) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO project_operations (
            id, project_id, source_system, source_record_type,
            source_record_id, title, description, status, priority,
            assignee_type, sage_write_status, sage_payload_json,
            sync_direction, sync_status, created_at, updated_at
          ) VALUES (?, ?, 'compass_template', 'staff_task', ?, ?, ?, 'open',
            'normal', 'internal', 'not_ready', ?, 'write', 'compass_only', ?, ?)`
        ).bind(
          todo.id,
          input.projectId,
          todo.sourceRecordId,
          todo.title,
          todo.description,
          todo.sourcePayloadJson,
          now,
          now
        )
      )
    }
    const selectionRooms = new Set(
      contentBuild.selections.map((selection) => selection.roomName)
    )
    for (const roomName of selectionRooms) {
      const roomKey = roomName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "whole-project"
      statements.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO project_finish_selection_rooms (
            id, project_id, source_system, room_name, sort_order,
            created_at, updated_at
          ) VALUES (?, ?, 'compass_template', ?, 1000, ?, ?)`
        ).bind(
          `template-room:${input.projectId}:${roomKey}`,
          input.projectId,
          roomName,
          now,
          now
        )
      )
    }
    // Imported selection choices need project-team review before an owner can
    // see them, even when Buildertrend marked a client response as required.
    for (const selection of contentBuild.selections) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO project_finish_selections (
            id, project_id, source_system, source_record_id, room_name,
            category, name, description, cost_code, status, owner_visible,
            owner_approved, notes, sort_order, sync_status, created_at,
            updated_at
          ) VALUES (?, ?, 'compass_template', ?, ?, ?, ?, ?, ?, ?, 0, 0,
            ?, ?, 'manual', ?, ?)`
        ).bind(
          selection.id,
          input.projectId,
          selection.sourceRecordId,
          selection.roomName,
          selection.category,
          selection.name,
          selection.description,
          selection.costCode,
          selection.status,
          selection.notes,
          selection.sortOrder,
          now,
          now
        )
      )
    }
    for (const bidPackage of contentBuild.bidPackages) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO project_operations (
            id, project_id, source_system, source_record_type,
            source_record_id, title, description, status, priority,
            assignee_type, cost_code, sage_cost_code, sage_write_status,
            sage_payload_json, sync_direction, sync_status, created_at,
            updated_at
          ) VALUES (?, ?, 'compass_template', 'rfq', ?, ?, ?, 'draft',
            'normal', 'vendor', ?, ?, 'not_ready', ?, 'write',
            'compass_only', ?, ?)`
        ).bind(
          bidPackage.id,
          input.projectId,
          bidPackage.sourceRecordId,
          bidPackage.title,
          bidPackage.description,
          bidPackage.costCode,
          bidPackage.costCode,
          bidPackage.sourcePayloadJson,
          now,
          now
        )
      )
    }
    statements.push(
      env.DB.prepare(
        `UPDATE project_template_applications
         SET status = 'applied', completed_at = ?
         WHERE id = ?`
      ).bind(now, applicationId)
    )

    const results = await env.DB.batch(statements)
    if (results.some((result) => !result.success)) {
      throw new Error("Template application batch failed")
    }
    try {
      await recalculateCriticalPath(db, input.projectId)
    } catch (error) {
      console.error("Unable to refresh critical path after template application", error)
    }
    try {
      await recordActivityEvent({
        db,
        organizationId,
        projectId: input.projectId,
        actor: user,
        category: "schedule",
        action: "project.template_applied",
        entityType: "project_template_application",
        entityId: applicationId,
        summary: `Applied project template “${template.name}”.`,
        metadata: {
          itemCount: totalItemCount,
          scheduleItemCount: build.data.tasks.length,
          taskCount: contentBuild.todos.length,
          selectionCount: contentBuild.selections.length,
          bidPackageCount: contentBuild.bidPackages.length,
          dependencyCount: build.data.dependencies.length,
          anchorDate: input.anchorDate,
        },
      })
    } catch (error) {
      console.error("Unable to record template application activity", error)
    }
    revalidatePath(`/dashboard/projects/${input.projectId}/schedule`)
    revalidatePath(`/dashboard/projects/${input.projectId}/todos`)
    revalidatePath(`/dashboard/projects/${input.projectId}/selections`)
    revalidatePath(`/dashboard/projects/${input.projectId}/rfqs`)
    revalidatePath(`/dashboard/projects/${input.projectId}/financials`)
    revalidatePath("/dashboard/schedule")
    revalidatePath("/dashboard/templates")
    return {
      success: true,
      applicationId,
      itemCount: totalItemCount,
      dependencyCount: build.data.dependencies.length,
      scheduleItemCount: build.data.tasks.length,
      taskCount: contentBuild.todos.length,
      selectionCount: contentBuild.selections.length,
      bidPackageCount: contentBuild.bidPackages.length,
    }
  } catch (error) {
    console.error("Unable to apply project template", error)
    return { success: false, error: "Unable to apply the template." }
  }
}

export async function setProjectTemplateLifecycle(input: {
  readonly templateId: string
  readonly lifecycleStatus: "active" | "inactive"
}): Promise<ActionResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    requirePermission(user, "schedule", "update")
    ensureInternalUser(user.role)
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const template = await db
      .select({ id: projectTemplates.id, reviewStatus: projectTemplates.reviewStatus })
      .from(projectTemplates)
      .where(
        and(
          eq(projectTemplates.id, input.templateId),
          eq(projectTemplates.organizationId, organizationId)
        )
      )
      .get()
    if (!template) return { success: false, error: "Template not found." }
    if (input.lifecycleStatus === "active" && template.reviewStatus !== "verified") {
      return { success: false, error: "Verify the template before activating it." }
    }
    await db
      .update(projectTemplates)
      .set({
        lifecycleStatus: input.lifecycleStatus,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(projectTemplates.id, input.templateId))
    revalidatePath("/dashboard/templates")
    return { success: true }
  } catch (error) {
    console.error("Unable to update template status", error)
    return { success: false, error: "Unable to update template status." }
  }
}

export async function publishCapturedProjectTemplate(input: {
  readonly templateId: string
}): Promise<ActionResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    requirePermission(user, "schedule", "update")
    ensureInternalUser(user.role)
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const template = await db
      .select()
      .from(projectTemplates)
      .where(
        and(
          eq(projectTemplates.id, input.templateId),
          eq(projectTemplates.organizationId, organizationId)
        )
      )
      .get()
    if (!template || template.currentVersionNumber === null) {
      return { success: false, error: "Template not found or content is missing." }
    }
    if (template.reviewStatus !== "content_captured") {
      return {
        success: false,
        error: "Only a fully captured draft can be reviewed and published.",
      }
    }

    const version = await db
      .select()
      .from(projectTemplateVersions)
      .where(
        and(
          eq(projectTemplateVersions.templateId, template.id),
          eq(projectTemplateVersions.versionNumber, template.currentVersionNumber),
          eq(projectTemplateVersions.status, "draft")
        )
      )
      .get()
    if (!version) {
      return { success: false, error: "The current captured version is not a draft." }
    }

    const [modules, contentItems, scheduleItems] = await Promise.all([
      db
        .select()
        .from(projectTemplateModules)
        .where(eq(projectTemplateModules.versionId, version.id)),
      db
        .select({ moduleType: projectTemplateContentItems.moduleType })
        .from(projectTemplateContentItems)
        .where(eq(projectTemplateContentItems.versionId, version.id)),
      db
        .select({ id: scheduleTemplateItems.id })
        .from(scheduleTemplateItems)
        .where(eq(scheduleTemplateItems.versionId, version.id)),
    ])
    const requiredModuleTypes = [
      "tasks",
      "schedule",
      "selections",
      "bid_packages",
    ] as const
    const counts = new Map<string, number>()
    for (const item of contentItems) {
      counts.set(item.moduleType, (counts.get(item.moduleType) ?? 0) + 1)
    }
    for (const moduleType of requiredModuleTypes) {
      const moduleRow = modules.find((item) => item.moduleType === moduleType)
      if (!moduleRow || !["captured", "captured_with_warnings"].includes(moduleRow.normalizationStatus)) {
        return {
          success: false,
          error: `The ${moduleType.replaceAll("_", " ")} module has not completed capture review.`,
        }
      }
      if ((counts.get(moduleType) ?? 0) !== moduleRow.sourceItemCount) {
        return {
          success: false,
          error: `The ${moduleType.replaceAll("_", " ")} module count does not match its reviewed source count.`,
        }
      }
    }
    const scheduleModule = modules.find((item) => item.moduleType === "schedule")
    if (!scheduleModule || scheduleItems.length !== scheduleModule.sourceItemCount) {
      return {
        success: false,
        error: "The reusable schedule count does not match its reviewed source count.",
      }
    }

    const now = new Date().toISOString()
    const results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE project_template_versions SET status='published', notes=? ` +
          `WHERE id=? AND status='draft'`
      ).bind(
        "Captured content reviewed in Compass and published by internal staff.",
        version.id
      ),
      env.DB.prepare(
        `UPDATE project_templates SET lifecycle_status='active', ` +
          `review_status='verified', updated_at=? ` +
          `WHERE id=? AND organization_id=? AND review_status='content_captured'`
      ).bind(now, template.id, organizationId),
    ])
    if (results.some((result) => !result.success)) {
      return { success: false, error: "Unable to publish the reviewed template." }
    }

    await recordActivityEvent({
      db,
      organizationId,
      actor: user,
      category: "schedule",
      action: "project_template.published",
      entityType: "project_template",
      entityId: template.id,
      summary: `Reviewed and published project template “${template.name}”.`,
      metadata: {
        versionNumber: version.versionNumber,
        capturedItemCount: contentItems.length,
        scheduleItemCount: scheduleItems.length,
        warningModuleCount: modules.filter(
          (module) => module.normalizationStatus === "captured_with_warnings"
        ).length,
      },
    })
    revalidatePath("/dashboard/templates")
    revalidatePath(`/dashboard/templates/${template.id}`)
    return { success: true }
  } catch (error) {
    console.error("Unable to publish captured project template", error)
    return { success: false, error: "Unable to publish the reviewed template." }
  }
}

export async function updateProjectTemplateCategory(input: {
  readonly templateId: string
  readonly category: string
}): Promise<ActionResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    requirePermission(user, "schedule", "update")
    ensureInternalUser(user.role)
    const organizationId = requireOrg(user)
    const category = input.category.trim()
    if (!category || category.length > 80) {
      return { success: false, error: "Choose a valid template category." }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const template = await db
      .select({ id: projectTemplates.id })
      .from(projectTemplates)
      .where(
        and(
          eq(projectTemplates.id, input.templateId),
          eq(projectTemplates.organizationId, organizationId)
        )
      )
      .get()
    if (!template) return { success: false, error: "Template not found." }

    await db
      .update(projectTemplates)
      .set({
        tradeCategory: category,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(projectTemplates.id, template.id))
    revalidatePath("/dashboard/templates")
    revalidatePath(`/dashboard/templates/${template.id}`)
    return { success: true }
  } catch (error) {
    console.error("Unable to update template classification", error)
    return { success: false, error: "Unable to update template classification." }
  }
}

export async function deleteProjectTemplate(input: {
  readonly templateId: string
}): Promise<ActionResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    requirePermission(user, "schedule", "update")
    ensureInternalUser(user.role)
    const organizationId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const template = await db
      .select({ id: projectTemplates.id, name: projectTemplates.name })
      .from(projectTemplates)
      .where(
        and(
          eq(projectTemplates.id, input.templateId),
          eq(projectTemplates.organizationId, organizationId)
        )
      )
      .get()
    if (!template) return { success: false, error: "Template not found." }

    const application = await db
      .select({ id: projectTemplateApplications.id })
      .from(projectTemplateApplications)
      .where(eq(projectTemplateApplications.templateId, template.id))
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (application) {
      return {
        success: false,
        error:
          "This template has already been applied to a project and must be retained for the project audit trail. Set it inactive instead.",
      }
    }

    await db.delete(projectTemplates).where(eq(projectTemplates.id, template.id))
    await recordActivityEvent({
      db,
      organizationId,
      actor: user,
      category: "schedule",
      action: "project_template.deleted",
      entityType: "project_template",
      entityId: template.id,
      summary: `Deleted project template “${template.name}”.`,
    })
    revalidatePath("/dashboard/templates")
    return { success: true }
  } catch (error) {
    console.error("Unable to delete template", error)
    return { success: false, error: "Unable to delete the template." }
  }
}
