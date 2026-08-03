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
import { buildScheduleTemplateApplication } from "@/lib/templates/schedule-template-application"

export type ProjectTemplateLibraryItem = {
  readonly id: string
  readonly name: string
  readonly description: string | null
  readonly sourceSystem: string
  readonly sourceUrl: string | null
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
      sourceUrl: template.sourceUrl,
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

export async function applyScheduleTemplate(input: {
  readonly projectId: string
  readonly templateId: string
  readonly anchorDate: string
}): Promise<
  | {
      readonly success: true
      readonly applicationId: string
      readonly itemCount: number
      readonly dependencyCount: number
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

    const [templateItems, templateDependencies, exceptionRows, lastTask] =
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
        build.data.tasks.length,
        build.data.dependencies.length,
        JSON.stringify({ assignmentMode: "preserve_placeholders" }),
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
    await recalculateCriticalPath(db, input.projectId)
    await recordActivityEvent({
      db,
      organizationId,
      projectId: input.projectId,
      actor: user,
      category: "schedule",
      action: "schedule.template_applied",
      entityType: "project_template_application",
      entityId: applicationId,
      summary: `Applied schedule template “${template.name}”.`,
      metadata: {
        itemCount: build.data.tasks.length,
        dependencyCount: build.data.dependencies.length,
        anchorDate: input.anchorDate,
      },
    })
    revalidatePath(`/dashboard/projects/${input.projectId}/schedule`)
    revalidatePath("/dashboard/schedule")
    revalidatePath("/dashboard/templates")
    return {
      success: true,
      applicationId,
      itemCount: build.data.tasks.length,
      dependencyCount: build.data.dependencies.length,
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
