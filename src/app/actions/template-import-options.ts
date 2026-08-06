"use server"

import { and, asc, eq, inArray } from "drizzle-orm"

import { getDb } from "@/db"
import {
  projectTemplateContentItems,
  projectTemplates,
  projectTemplateVersions,
  scheduleTemplateItems
} from "@/db/schema-templates"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { requireOrg } from "@/lib/org-scope"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { requirePermission } from "@/lib/permissions"
import { isInternalStaffRole } from "@/lib/user-roles"
import { buildProjectTemplateContentApplication } from "@/lib/templates/project-template-content-application"
import { groupTemplateChecklistItems } from "@/lib/templates/template-checklist-hierarchy"
import {
  parseTemplateChoiceOptions,
  resolveTemplateSchedulePhase
} from "@/lib/templates/template-creation-import"

export type ScheduleTemplateImportTodo = {
  readonly id: string
  readonly title: string
  readonly checklistItemCount: number
}

export type ScheduleTemplateImportItem = {
  readonly id: string
  readonly title: string
  readonly startOffsetWorkdays: number
  readonly workdays: number
  readonly phase: string
  readonly displayColor: string
  readonly isMilestone: boolean
  readonly assignedTo: string | null
  readonly ownerVisible: boolean
  readonly subVendorVisible: boolean
  readonly sortOrder: number
}

export type ScheduleTemplateImportGroup = {
  readonly templateId: string
  readonly templateName: string
  readonly tradeCategory: string
  readonly scheduleItems: readonly ScheduleTemplateImportItem[]
  readonly linkedTodos: readonly ScheduleTemplateImportTodo[]
}

export type FinishSelectionTemplateImportItem = {
  readonly id: string
  readonly title: string
  readonly roomName: string
  readonly category: string
  readonly description: string | null
  readonly costCode: string | null
  readonly notes: string | null
  readonly choiceOptions: readonly string[]
}

export type FinishSelectionTemplateImportGroup = {
  readonly templateId: string
  readonly templateName: string
  readonly tradeCategory: string
  readonly selections: readonly FinishSelectionTemplateImportItem[]
}

type PublishedTemplateVersion = {
  readonly templateId: string
  readonly templateName: string
  readonly tradeCategory: string | null
  readonly versionId: string
}

function ensureInternalUser(role: string): void {
  if (!isInternalStaffRole(role)) {
    throw new Error("Template imports are limited to internal staff.")
  }
}

async function publishedTemplateVersions(
  organizationId: string
): Promise<readonly PublishedTemplateVersion[]> {
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  return db
    .select({
      templateId: projectTemplates.id,
      templateName: projectTemplates.name,
      tradeCategory: projectTemplates.tradeCategory,
      versionId: projectTemplateVersions.id
    })
    .from(projectTemplates)
    .innerJoin(projectTemplateVersions, eq(projectTemplateVersions.templateId, projectTemplates.id))
    .where(
      and(
        eq(projectTemplates.organizationId, organizationId),
        eq(projectTemplates.lifecycleStatus, "active"),
        eq(projectTemplates.reviewStatus, "verified"),
        eq(projectTemplateVersions.status, "published"),
        eq(projectTemplateVersions.versionNumber, projectTemplates.currentVersionNumber)
      )
    )
    .orderBy(asc(projectTemplates.tradeCategory), asc(projectTemplates.name))
}

export async function getScheduleTemplateImportOptions(): Promise<
  readonly ScheduleTemplateImportGroup[]
> {
  const user = await requireAuth()
  requirePermission(user, "schedule", "read")
  ensureInternalUser(user.role)
  const organizationId = requireOrg(user)
  const versions = await publishedTemplateVersions(organizationId)
  if (versions.length === 0) return []

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const versionIds = versions.map((version) => version.versionId)
  const [scheduleItems, taskItems] = await Promise.all([
    db
      .select()
      .from(scheduleTemplateItems)
      .where(inArray(scheduleTemplateItems.versionId, versionIds))
      .orderBy(asc(scheduleTemplateItems.sortOrder)),
    db
      .select()
      .from(projectTemplateContentItems)
      .where(
        and(
          inArray(projectTemplateContentItems.versionId, versionIds),
          eq(projectTemplateContentItems.moduleType, "tasks")
        )
      )
      .orderBy(asc(projectTemplateContentItems.sortOrder))
  ])

  return versions.flatMap((version) => {
    const items = scheduleItems.filter((item) => item.versionId === version.versionId)
    if (items.length === 0) return []
    const todoGroups = groupTemplateChecklistItems(
      taskItems.filter((item) => item.versionId === version.versionId)
    )
    return [
      {
        templateId: version.templateId,
        templateName: version.templateName,
        tradeCategory: version.tradeCategory ?? "Other",
        scheduleItems: items.map((item) => ({
          id: item.id,
          title: item.title,
          startOffsetWorkdays: item.startOffsetWorkdays,
          workdays: item.workdays,
          phase: resolveTemplateSchedulePhase({
            capturedPhase: item.phase,
            tradeCategory: version.tradeCategory
          }),
          displayColor: item.displayColor,
          isMilestone: item.isMilestone,
          assignedTo: item.assigneePlaceholder,
          ownerVisible: item.ownerVisible,
          subVendorVisible: item.subVendorVisible,
          sortOrder: item.sortOrder
        })),
        linkedTodos: todoGroups.map((group) => ({
          id: group.task.id,
          title: group.task.title,
          checklistItemCount: group.checklistItems.length
        }))
      }
    ]
  })
}

export async function getFinishSelectionTemplateImportOptions(): Promise<
  readonly FinishSelectionTemplateImportGroup[]
> {
  const user = await requireAuth()
  await requireFeaturePermission(user, "finish-selections", "read")
  ensureInternalUser(user.role)
  const organizationId = requireOrg(user)
  const versions = await publishedTemplateVersions(organizationId)
  if (versions.length === 0) return []

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const contentItems = await db
    .select()
    .from(projectTemplateContentItems)
    .where(
      and(
        inArray(
          projectTemplateContentItems.versionId,
          versions.map((version) => version.versionId)
        ),
        eq(projectTemplateContentItems.moduleType, "selections")
      )
    )
    .orderBy(asc(projectTemplateContentItems.sortOrder))

  return versions.flatMap((version) => {
    let nextId = 0
    const build = buildProjectTemplateContentApplication({
      applicationId: `selection-import-preview:${version.templateId}`,
      items: contentItems.filter((item) => item.versionId === version.versionId),
      nextId: () => `selection-import-preview:${nextId++}`
    })
    const selections = build.selections.flatMap((selection) => {
      const choiceOptions = parseTemplateChoiceOptions(selection.choiceOptionsJson)
      if (choiceOptions.length === 0) return []
      return [
        {
          id: selection.templateContentItemId,
          title: selection.name,
          roomName: selection.roomName,
          category: selection.category,
          description: selection.description,
          costCode: selection.costCode,
          notes: selection.notes,
          choiceOptions
        }
      ]
    })
    if (selections.length === 0) return []
    return [
      {
        templateId: version.templateId,
        templateName: version.templateName,
        tradeCategory: version.tradeCategory ?? "Other",
        selections
      }
    ]
  })
}
