/**
 * Reads of published schedule templates used when staff import template
 * items (and their linked to-dos) into a project schedule.
 */
import { and, asc, eq } from "drizzle-orm"

import {
  projectTemplateContentItems,
  projectTemplates,
  projectTemplateVersions,
  scheduleTemplateItems
} from "@/db/schema-templates"
import type { Db } from "@/lib/server/action-context"
import {
  formatTemplateChecklist,
  groupTemplateChecklistItems
} from "@/lib/templates/template-checklist-hierarchy"

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

export async function loadScheduleTemplateItemImport(
  db: Db,
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

export async function loadScheduleTemplateTodos(
  db: Db,
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
