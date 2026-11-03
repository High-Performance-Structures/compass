"use server"

import { and, asc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import {
  projects,
  scheduleTasks,
  taskDependencies,
  workdayExceptions,
} from "@/db/schema"
import { projectTemplates } from "@/db/schema-templates"
import { recordActivityEvent } from "@/lib/activity-log"
import { isDemoUser } from "@/lib/demo"
import { dependencyType, exceptionData } from "@/lib/domain/templates/rules"
import { savedScheduleTemplateStatements } from "@/lib/domain/templates/store"
import { requirePermission } from "@/lib/permissions"
import { orgContext, type OrgContext } from "@/lib/server/action-context"
import {
  SAVED_SCHEDULE_TEMPLATE_KIND,
  captureScheduleTemplate,
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

/** The shared org context; a failure is thrown with its message, as before. */
async function scheduleTemplateContext(): Promise<OrgContext> {
  const context = await orgContext()
  if (!context.success) throw new Error(context.error)
  return context.data
}

function ensureStaff(role: string): string | null {
  return isInternalStaffRole(role) || role === "developer"
    ? null
    : "Only internal staff can save schedule templates."
}

export async function getSavedScheduleTemplates(): Promise<
  readonly SavedScheduleTemplateOption[]
> {
  const { user, organizationId, db } = await scheduleTemplateContext()
  requirePermission(user, "schedule", "read")
  if (ensureStaff(user.role)) return []
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
    const { user, organizationId, db, env } = await scheduleTemplateContext()
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    requirePermission(user, "schedule", "update")
    const staffError = ensureStaff(user.role)
    if (staffError) return { success: false, error: staffError }

    const name = input.name.trim()
    const category = input.category.trim()
    const description = input.description.trim()
    if (input.replaceTemplateId === null && (name.length < 2 || name.length > 120)) {
      return { success: false, error: "Enter a template name (2 to 120 characters)." }
    }
    if (category.length > 80 || description.length > 1000) {
      return { success: false, error: "The category or description is too long." }
    }

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
    const statements = savedScheduleTemplateStatements(env.DB, {
      header: existing
        ? {
            kind: "existing",
            templateId,
            organizationId,
            versionNumber,
            name: name || existing.name,
            tradeCategory: category || existing.tradeCategory,
            description: description || existing.description,
            now,
          }
        : {
            kind: "new",
            templateId,
            organizationId,
            versionNumber,
            name,
            description: description || null,
            templateKind: SAVED_SCHEDULE_TEMPLATE_KIND,
            tradeCategory: category || "Schedules",
            sourceMetadataJson: JSON.stringify({ sourceProjectId: project.id }),
            now,
          },
      versionId,
      moduleId: crypto.randomUUID(),
      createdBy: user.id,
      versionNotes: `Saved from the ${project.name} schedule.`,
      modulePayloadJson: JSON.stringify({ sourceProjectId: project.id, dependencyCount: dependencies.length }),
      items,
      dependencies,
    })

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
