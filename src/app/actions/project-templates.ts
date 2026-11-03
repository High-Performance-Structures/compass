"use server"

import { and, asc, desc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import {
  projects,
  scheduleTasks,
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
import { requirePermission } from "@/lib/permissions"
import { isDemoUser } from "@/lib/demo"
import { isInternalStaffRole } from "@/lib/user-roles"
import { recordActivityEvent } from "@/lib/activity-log"
import {
  templateFinishSelectionStatement,
  templateSelectionRoomStatement,
} from "@/lib/domain/selections/store"
import {
  dependencyInsertStatement,
  recalcCriticalPath,
  templateTaskInsertStatement,
} from "@/lib/domain/schedule/store"
import {
  loadProjectTemplateContentItems,
  loadProjectTemplateLibrary,
  loadProjectTemplatePreview,
} from "@/lib/domain/templates/project-template-reads"
import { exceptionData, isIsoDate } from "@/lib/domain/templates/rules"
import {
  completeTemplateApplicationStatement,
  deleteTemplates,
  insertProjectTemplateApplicationStatement,
  insertTemplateApplicationItemStatement,
  publishCapturedTemplateStatements,
  updateTemplates,
} from "@/lib/domain/templates/store"
import type {
  ProjectTemplateContentItem,
  ProjectTemplateLibraryItem,
  ProjectTemplatePreview,
} from "@/lib/domain/templates/types"
import { orgContext, type OrgContext } from "@/lib/server/action-context"
import { buildProjectTemplateContentApplication } from "@/lib/templates/project-template-content-application"
import { buildScheduleTemplateApplication } from "@/lib/templates/schedule-template-application"
import { templateBidPackageInsertStatement, templateStaffTodoInsertStatement } from "@/lib/domain/operations/store"

export type {
  ProjectTemplateContentItem,
  ProjectTemplateLibraryItem,
  ProjectTemplatePreview,
} from "@/lib/domain/templates/types"

type ActionResult =
  | { readonly success: true }
  | { readonly success: false; readonly error: string }

function ensureInternalUser(role: string): void {
  if (!isInternalStaffRole(role)) {
    throw new Error("Template management is limited to internal staff.")
  }
}

/** The shared org context; a failure is thrown with its message, as before. */
async function templateContext(): Promise<OrgContext> {
  const context = await orgContext()
  if (!context.success) throw new Error(context.error)
  return context.data
}

async function readableLibrary(): Promise<{
  readonly context: OrgContext
  readonly library: readonly ProjectTemplateLibraryItem[]
}> {
  const context = await templateContext()
  requirePermission(context.user, "schedule", "read")
  ensureInternalUser(context.user.role)
  return {
    context,
    library: await loadProjectTemplateLibrary(context.db, context.organizationId),
  }
}

export async function getProjectTemplateLibrary(): Promise<
  readonly ProjectTemplateLibraryItem[]
> {
  return (await readableLibrary()).library
}

export async function getProjectTemplateContent(
  templateId: string
): Promise<readonly ProjectTemplateContentItem[]> {
  const { context, library } = await readableLibrary()
  const template = library.find((candidate) => candidate.id === templateId)
  if (!template?.currentVersionId) return []
  return loadProjectTemplateContentItems(context.db, template.currentVersionId)
}

export async function getProjectTemplatePreview(
  templateId: string
): Promise<ProjectTemplatePreview | null> {
  const { context, library } = await readableLibrary()
  const template = library.find((candidate) => candidate.id === templateId)
  if (!template) return null
  const { currentVersionId } = template
  if (!currentVersionId) return { ...template, scheduleItems: [], assigneePlaceholders: [] }
  return loadProjectTemplatePreview(context.db, { ...template, currentVersionId })
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
    const { user, organizationId, db, env } = await templateContext()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "schedule", "update")
    ensureInternalUser(user.role)
    if (!isIsoDate(input.anchorDate)) {
      return { success: false, error: "Choose a valid template start date." }
    }

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
      insertProjectTemplateApplicationStatement(env.DB, {
        id: applicationId,
        organizationId,
        projectId: input.projectId,
        templateId: template.id,
        versionId: version.id,
        anchorDate: input.anchorDate,
        appliedBy: user.id,
        itemCount: totalItemCount,
        dependencyCount: build.data.dependencies.length,
        optionsJson: JSON.stringify({
          assignmentMode: "preserve_placeholders",
          scheduleItemCount: build.data.tasks.length,
          taskCount: contentBuild.todos.length,
          selectionCount: contentBuild.selections.length,
          bidPackageCount: contentBuild.bidPackages.length,
        }),
        now,
      }),
    ]

    for (const task of build.data.tasks) {
      // Template applications have always left item notes empty.
      statements.push(templateTaskInsertStatement(env.DB, input.projectId, task, now, null))
      statements.push(
        insertTemplateApplicationItemStatement(env.DB, {
          id: crypto.randomUUID(),
          applicationId,
          templateItemId: task.templateItemId,
          scheduleTaskId: task.id,
        })
      )
    }

    for (const dependency of build.data.dependencies) {
      statements.push(dependencyInsertStatement(env.DB, dependency))
    }
    for (const todo of contentBuild.todos) {
      statements.push(
        templateStaffTodoInsertStatement(env.DB, {
          id: todo.id,
          projectId: input.projectId,
          sourceRecordId: todo.sourceRecordId,
          title: todo.title,
          description: todo.description,
          payloadJson: todo.sourcePayloadJson,
          now,
        })
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
        templateSelectionRoomStatement(env.DB, {
          id: `template-room:${input.projectId}:${roomKey}`,
          projectId: input.projectId,
          roomName,
          now,
        })
      )
    }
    // Imported selection choices need project-team review before an owner can
    // see them, even when Buildertrend marked a client response as required.
    for (const selection of contentBuild.selections) {
      statements.push(
        templateFinishSelectionStatement(env.DB, {
          id: selection.id,
          projectId: input.projectId,
          sourceRecordId: selection.sourceRecordId,
          roomName: selection.roomName,
          category: selection.category,
          name: selection.name,
          description: selection.description,
          costCode: selection.costCode,
          status: selection.status,
          notes: selection.notes,
          choiceOptionsJson: selection.choiceOptionsJson,
          parentSelectionId: selection.parentSelectionId,
          parentChoiceValue: selection.parentChoiceValue,
          selectionLevel: selection.selectionLevel,
          sortOrder: selection.sortOrder,
          now,
        })
      )
    }
    for (const bidPackage of contentBuild.bidPackages) {
      statements.push(
        templateBidPackageInsertStatement(env.DB, {
          id: bidPackage.id,
          projectId: input.projectId,
          sourceRecordId: bidPackage.sourceRecordId,
          title: bidPackage.title,
          description: bidPackage.description,
          costCode: bidPackage.costCode,
          payloadJson: bidPackage.sourcePayloadJson,
          now,
        })
      )
    }
    statements.push(completeTemplateApplicationStatement(env.DB, applicationId, now))

    const results = await env.DB.batch(statements)
    if (results.some((result) => !result.success)) {
      throw new Error("Template application batch failed")
    }
    try {
      await recalcCriticalPath(db, input.projectId)
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

export async function publishCapturedProjectTemplate(input: {
  readonly templateId: string
}): Promise<ActionResult> {
  try {
    const { user, organizationId, db, env } = await templateContext()
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    requirePermission(user, "schedule", "update")
    ensureInternalUser(user.role)
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
    const results = await env.DB.batch(
      publishCapturedTemplateStatements(env.DB, {
        templateId: template.id,
        versionId: version.id,
        organizationId,
        now,
      })
    )
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
    const { user, organizationId, db } = await templateContext()
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    requirePermission(user, "schedule", "update")
    ensureInternalUser(user.role)
    const category = input.category.trim()
    if (!category || category.length > 80) {
      return { success: false, error: "Choose a valid template category." }
    }

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

    await updateTemplates(db, eq(projectTemplates.id, template.id), {
      tradeCategory: category,
      updatedAt: new Date().toISOString(),
    })
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
    const { user, organizationId, db } = await templateContext()
    if (isDemoUser(user.id)) return { success: false, error: "DEMO_READ_ONLY" }
    requirePermission(user, "schedule", "update")
    ensureInternalUser(user.role)
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

    await deleteTemplates(db, eq(projectTemplates.id, template.id))
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
