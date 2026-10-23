"use server"

import { and, asc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  projects,
  scheduleTasks,
  taskDependencies,
  workdayExceptions,
} from "@/db/schema"
import { projectTemplates } from "@/db/schema-templates"
import { recordActivityEvent } from "@/lib/activity-log"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { requireOrg } from "@/lib/org-scope"
import { requirePermission } from "@/lib/permissions"
import type {
  DependencyType,
  ExceptionCategory,
  ExceptionRecurrence,
  WorkdayExceptionData,
  WorkdayExceptionType,
} from "@/lib/schedule/types"
import {
  SAVED_SCHEDULE_TEMPLATE_KIND,
  captureScheduleTemplate,
  type CapturedScheduleTemplateDependency,
  type CapturedScheduleTemplateItem,
} from "@/lib/templates/schedule-template-capture"
import { isInternalStaffRole } from "@/lib/user-roles"

export type SavedScheduleTemplateOption = {
  readonly id: string
  readonly name: string
  readonly tradeCategory: string | null
  readonly currentVersionNumber: number | null
}

type SaveResult =
  | {
      readonly success: true
      readonly templateId: string
      readonly versionNumber: number
      readonly itemCount: number
      readonly dependencyCount: number
    }
  | { readonly success: false; readonly error: string }

// D1 binds at most 100 parameters per statement.
const ITEM_COLUMNS = 15
const DEPENDENCY_COLUMNS = 6
const MAX_BOUND_PARAMETERS = 100

function chunk<T>(values: readonly T[], size: number): readonly (readonly T[])[] {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

function dependencyType(value: string): DependencyType {
  return value === "SS" || value === "FF" || value === "SF" ? value : "FS"
}

function exceptionData(row: typeof workdayExceptions.$inferSelect): WorkdayExceptionData {
  const type: WorkdayExceptionType = row.type === "working" ? "working" : "non_working"
  const recurrence: ExceptionRecurrence = row.recurrence === "yearly" ? "yearly" : "one_time"
  const categories: readonly ExceptionCategory[] = [
    "national_holiday",
    "state_holiday",
    "vacation_day",
    "company_holiday",
    "weather_day",
    "extra_workday",
  ]
  const category =
    categories.find((candidate) => candidate === row.category) ?? "company_holiday"
  return { ...row, type, recurrence, category }
}

function ensureStaff(role: string): string | null {
  return isInternalStaffRole(role) || role === "developer"
    ? null
    : "Only internal staff can save schedule templates."
}

export async function getSavedScheduleTemplates(): Promise<
  readonly SavedScheduleTemplateOption[]
> {
  const user = await requireAuth()
  requirePermission(user, "schedule", "read")
  if (ensureStaff(user.role)) return []
  const organizationId = requireOrg(user)
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  return db
    .select({
      id: projectTemplates.id,
      name: projectTemplates.name,
      tradeCategory: projectTemplates.tradeCategory,
      currentVersionNumber: projectTemplates.currentVersionNumber,
    })
    .from(projectTemplates)
    .where(
      and(
        eq(projectTemplates.organizationId, organizationId),
        eq(projectTemplates.templateKind, SAVED_SCHEDULE_TEMPLATE_KIND)
      )
    )
    .orderBy(asc(projectTemplates.name))
}

/**
 * Saves a project's whole schedule, predecessors included, as a published
 * template. With `replaceTemplateId` the template gets a new version and
 * earlier versions stay for projects that already used them.
 */
export async function saveScheduleAsTemplate(input: {
  readonly projectId: string
  readonly name: string
  readonly category: string
  readonly description: string
  readonly replaceTemplateId: string | null
}): Promise<SaveResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    requirePermission(user, "schedule", "update")
    const staffError = ensureStaff(user.role)
    if (staffError) return { success: false, error: staffError }
    const organizationId = requireOrg(user)

    const name = input.name.trim()
    const category = input.category.trim()
    const description = input.description.trim()
    if (input.replaceTemplateId === null && (name.length < 2 || name.length > 120)) {
      return { success: false, error: "Enter a template name (2 to 120 characters)." }
    }
    if (category.length > 80 || description.length > 1000) {
      return { success: false, error: "The category or description is too long." }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const project = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(and(eq(projects.id, input.projectId), eq(projects.organizationId, organizationId)))
      .get()
    if (!project) return { success: false, error: "Project not found or access denied" }

    const existing = input.replaceTemplateId
      ? await db
          .select()
          .from(projectTemplates)
          .where(
            and(
              eq(projectTemplates.id, input.replaceTemplateId),
              eq(projectTemplates.organizationId, organizationId),
              eq(projectTemplates.templateKind, SAVED_SCHEDULE_TEMPLATE_KIND)
            )
          )
          .get()
      : null
    if (input.replaceTemplateId && !existing) {
      return { success: false, error: "That saved schedule template is no longer available." }
    }

    const [tasks, dependencyRows, exceptionRows] = await Promise.all([
      db
        .select()
        .from(scheduleTasks)
        .where(eq(scheduleTasks.projectId, project.id))
        .orderBy(asc(scheduleTasks.sortOrder)),
      db
        .select({
          predecessorId: taskDependencies.predecessorId,
          successorId: taskDependencies.successorId,
          type: taskDependencies.type,
          lagDays: taskDependencies.lagDays,
        })
        .from(taskDependencies)
        .innerJoin(scheduleTasks, eq(scheduleTasks.id, taskDependencies.successorId))
        .where(eq(scheduleTasks.projectId, project.id)),
      db
        .select()
        .from(workdayExceptions)
        .where(eq(workdayExceptions.projectId, project.id)),
    ])
    const capture = captureScheduleTemplate({
      tasks: tasks.map((task) => ({
        id: task.id,
        title: task.title,
        notes: task.notes,
        startDate: task.startDate,
        workdays: task.workdays,
        phase: task.phase,
        displayColor: task.displayColor,
        isMilestone: task.isMilestone,
        assignedTo: task.assignedTo,
        ownerVisible: task.ownerVisible,
        subVendorVisible: task.subVendorVisible,
        sortOrder: task.sortOrder,
      })),
      dependencies: dependencyRows.map((row) => ({
        ...row,
        type: dependencyType(row.type),
      })),
      exceptions: exceptionRows.map(exceptionData),
      nextId: () => crypto.randomUUID(),
    })
    if (!capture.success) return capture

    const now = new Date().toISOString()
    const templateId = existing?.id ?? crypto.randomUUID()
    const versionId = crypto.randomUUID()
    const versionNumber = (existing?.currentVersionNumber ?? 0) + 1
    const { items, dependencies } = capture.data
    const statements: D1PreparedStatement[] = []

    if (existing) {
      statements.push(
        env.DB.prepare(
          `UPDATE project_templates SET current_version_number = ?,
            name = ?, trade_category = ?, description = ?,
            lifecycle_status = 'active', review_status = 'verified',
            updated_at = ?
          WHERE id = ? AND organization_id = ?`
        ).bind(
          versionNumber,
          name || existing.name,
          category || existing.tradeCategory,
          description || existing.description,
          now,
          templateId,
          organizationId
        )
      )
    } else {
      statements.push(
        env.DB.prepare(
          `INSERT INTO project_templates (
            id, organization_id, source_system, source_key, source_template_id,
            source_url, name, description, template_kind, department_code,
            trade_category, lifecycle_status, review_status,
            current_version_number, source_metadata_json, created_by,
            created_at, updated_at
          ) VALUES (?, ?, 'compass', ?, NULL, NULL, ?, ?, ?, NULL, ?,
            'active', 'verified', ?, ?, ?, ?, ?)`
        ).bind(
          templateId,
          organizationId,
          `schedule:${templateId}`,
          name,
          description || null,
          SAVED_SCHEDULE_TEMPLATE_KIND,
          category || "Schedules",
          versionNumber,
          JSON.stringify({ sourceProjectId: project.id }),
          user.id,
          now,
          now
        )
      )
    }

    statements.push(
      env.DB.prepare(
        `INSERT INTO project_template_versions (
          id, template_id, version_number, status, source_fingerprint,
          source_captured_at, notes, created_by, created_at
        ) VALUES (?, ?, ?, 'published', NULL, ?, ?, ?, ?)`
      ).bind(
        versionId,
        templateId,
        versionNumber,
        now,
        `Saved from the ${project.name} schedule.`,
        user.id,
        now
      ),
      env.DB.prepare(
        `INSERT INTO project_template_modules (
          id, version_id, module_type, source_item_count,
          normalization_status, source_payload_json
        ) VALUES (?, ?, 'schedule', ?, 'captured', ?)`
      ).bind(
        crypto.randomUUID(),
        versionId,
        items.length,
        JSON.stringify({ sourceProjectId: project.id, dependencyCount: dependencies.length })
      )
    )
    statements.push(...itemStatements(env.DB, versionId, items))
    statements.push(...dependencyStatements(env.DB, versionId, dependencies))

    const results = await env.DB.batch(statements)
    if (results.some((result) => !result.success)) {
      throw new Error("Schedule template save batch failed")
    }

    try {
      await recordActivityEvent({
        db,
        organizationId,
        projectId: project.id,
        actor: user,
        category: "schedule",
        action: "schedule.saved_as_template",
        entityType: "project_template",
        entityId: templateId,
        summary: existing
          ? `Saved the schedule as version ${versionNumber} of template “${existing.name}”.`
          : `Saved the schedule as template “${name}”.`,
        metadata: {
          templateId,
          versionNumber,
          itemCount: items.length,
          dependencyCount: dependencies.length,
        },
      })
    } catch (error) {
      console.error("Unable to record schedule template activity", error)
    }
    revalidatePath("/dashboard/templates")
    revalidatePath(`/dashboard/templates/${templateId}`)
    return {
      success: true,
      templateId,
      versionNumber,
      itemCount: items.length,
      dependencyCount: dependencies.length,
    }
  } catch (error) {
    console.error("Unable to save schedule as template", error)
    return { success: false, error: "Unable to save the schedule as a template." }
  }
}

function itemStatements(
  database: D1Database,
  versionId: string,
  items: readonly CapturedScheduleTemplateItem[]
): readonly D1PreparedStatement[] {
  return chunk(items, Math.floor(MAX_BOUND_PARAMETERS / ITEM_COLUMNS)).map((rows) =>
    database
      .prepare(
        `INSERT INTO schedule_template_items (
          id, version_id, source_item_id, item_key, title,
          start_offset_workdays, workdays, phase, display_color, is_milestone,
          assignee_placeholder, owner_visible, sub_vendor_visible, notes,
          sort_order
        ) VALUES ${rows.map(() => `(${Array(ITEM_COLUMNS).fill("?").join(", ")})`).join(", ")}`
      )
      .bind(
        ...rows.flatMap((item) => [
          item.id,
          versionId,
          item.sourceItemId,
          item.itemKey,
          item.title,
          item.startOffsetWorkdays,
          item.workdays,
          item.phase,
          item.displayColor,
          item.isMilestone ? 1 : 0,
          item.assigneePlaceholder,
          item.ownerVisible ? 1 : 0,
          item.subVendorVisible ? 1 : 0,
          item.notes,
          item.sortOrder,
        ])
      )
  )
}

function dependencyStatements(
  database: D1Database,
  versionId: string,
  dependencies: readonly CapturedScheduleTemplateDependency[]
): readonly D1PreparedStatement[] {
  return chunk(
    dependencies,
    Math.floor(MAX_BOUND_PARAMETERS / DEPENDENCY_COLUMNS)
  ).map((rows) =>
    database
      .prepare(
        `INSERT INTO schedule_template_dependencies (
          id, version_id, predecessor_item_id, successor_item_id, type, lag_days
        ) VALUES ${rows.map(() => `(${Array(DEPENDENCY_COLUMNS).fill("?").join(", ")})`).join(", ")}`
      )
      .bind(
        ...rows.flatMap((dependency) => [
          dependency.id,
          versionId,
          dependency.predecessorItemId,
          dependency.successorItemId,
          dependency.type,
          dependency.lagDays,
        ])
      )
  )
}
