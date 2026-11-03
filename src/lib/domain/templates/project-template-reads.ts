import { asc, eq, inArray } from "drizzle-orm"

import {
  projectTemplateContentItems,
  projectTemplateModules,
  projectTemplates,
  projectTemplateVersions,
  scheduleTemplateDependencies,
  scheduleTemplateItems,
} from "@/db/schema-templates"
import type { Db } from "@/lib/server/action-context"

import type {
  ProjectTemplateContentItem,
  ProjectTemplateLibraryItem,
  ProjectTemplatePreview,
} from "./types"

/*
 * Reads for the project template library, scoped to one organization in SQL.
 * Moved unchanged from the project template actions.
 */

export async function loadProjectTemplateLibrary(
  db: Db,
  organizationId: string
): Promise<readonly ProjectTemplateLibraryItem[]> {
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

export async function loadProjectTemplateContentItems(
  db: Db,
  versionId: string
): Promise<readonly ProjectTemplateContentItem[]> {
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
    .where(eq(projectTemplateContentItems.versionId, versionId))
    .orderBy(
      asc(projectTemplateContentItems.moduleType),
      asc(projectTemplateContentItems.sortOrder)
    )
}

/** The library item plus its current version's schedule items. */
export async function loadProjectTemplatePreview(
  db: Db,
  template: ProjectTemplateLibraryItem & { readonly currentVersionId: string }
): Promise<ProjectTemplatePreview> {
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
