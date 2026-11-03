/**
 * Staff selections workspace reads: the selections summary, the picker
 * options and published template selections. Access is resolved by the caller.
 */
import { and, asc, eq } from "drizzle-orm"

import { projectContacts, projectFinishSelectionRooms, projectFinishSelections } from "@/db/schema"
import {
  projectTemplateContentItems,
  projectTemplates,
  projectTemplateVersions
} from "@/db/schema-templates"
import { loadProjectCostCodeChoices } from "@/lib/cost-codes/catalog-server"
import type { Db } from "@/lib/server/action-context"
import { buildProjectTemplateContentApplication } from "@/lib/templates/project-template-content-application"
import { parseTemplateChoiceOptions } from "@/lib/templates/template-creation-import"

import { buildSelectionOptions, summarizeSelections, toSelectionItem } from "./rules"
import type { ProjectSelectionOptions, ProjectSelectionsSummary } from "./types"

export async function loadProjectSelections(
  db: Db,
  projectId: string
): Promise<ProjectSelectionsSummary> {
  const [roomRows, selectionRows] = await Promise.all([
    db
      .select()
      .from(projectFinishSelectionRooms)
      .where(
        and(
          eq(projectFinishSelectionRooms.projectId, projectId),
          eq(projectFinishSelectionRooms.active, true)
        )
      )
      .orderBy(
        asc(projectFinishSelectionRooms.sortOrder),
        asc(projectFinishSelectionRooms.roomName)
      ),
    db
      .select()
      .from(projectFinishSelections)
      .where(eq(projectFinishSelections.projectId, projectId))
      .orderBy(
        asc(projectFinishSelections.roomName),
        asc(projectFinishSelections.category),
        asc(projectFinishSelections.sortOrder),
        asc(projectFinishSelections.name)
      )
  ])

  return summarizeSelections(roomRows, selectionRows.map(toSelectionItem))
}

export async function loadProjectSelectionOptions(
  db: Db,
  projectId: string
): Promise<ProjectSelectionOptions> {
  const [costCodes, contacts, selections] = await Promise.all([
    loadProjectCostCodeChoices(db, projectId),
    db
      .select({
        companyName: projectContacts.companyName,
        displayName: projectContacts.displayName,
        contactType: projectContacts.contactType,
        csiDivision: projectContacts.csiDivision,
        csiDivisionName: projectContacts.csiDivisionName,
        primaryCostCode: projectContacts.primaryCostCode
      })
      .from(projectContacts)
      .where(and(eq(projectContacts.projectId, projectId), eq(projectContacts.active, true)))
      .orderBy(asc(projectContacts.companyName), asc(projectContacts.displayName)),
    db
      .select({
        manufacturer: projectFinishSelections.manufacturer,
        supplierName: projectFinishSelections.supplierName,
        costCode: projectFinishSelections.costCode,
        category: projectFinishSelections.category
      })
      .from(projectFinishSelections)
      .where(eq(projectFinishSelections.projectId, projectId))
  ])
  return buildSelectionOptions({ costCodes, contacts, selections })
}

export type PublishedTemplateSelection = {
  readonly templateId: string
  readonly templateContentItemId: string
  readonly choiceOptions: readonly string[]
}

export async function loadPublishedTemplateSelection(
  db: Db,
  organizationId: string,
  templateId: string,
  templateContentItemId: string
): Promise<PublishedTemplateSelection | null> {
  const matches = await db
    .select({
      templateId: projectTemplates.id,
      versionId: projectTemplateVersions.id,
      templateContentItemId: projectTemplateContentItems.id
    })
    .from(projectTemplateContentItems)
    .innerJoin(
      projectTemplateVersions,
      eq(projectTemplateVersions.id, projectTemplateContentItems.versionId)
    )
    .innerJoin(projectTemplates, eq(projectTemplates.id, projectTemplateVersions.templateId))
    .where(
      and(
        eq(projectTemplates.id, templateId),
        eq(projectTemplates.organizationId, organizationId),
        eq(projectTemplates.lifecycleStatus, "active"),
        eq(projectTemplates.reviewStatus, "verified"),
        eq(projectTemplateVersions.status, "published"),
        eq(projectTemplateVersions.versionNumber, projectTemplates.currentVersionNumber),
        eq(projectTemplateContentItems.id, templateContentItemId),
        eq(projectTemplateContentItems.moduleType, "selections")
      )
    )
    .limit(1)
  const match = matches[0]
  if (!match) return null

  const versionItems = await db
    .select()
    .from(projectTemplateContentItems)
    .where(
      and(
        eq(projectTemplateContentItems.versionId, match.versionId),
        eq(projectTemplateContentItems.moduleType, "selections")
      )
    )
    .orderBy(asc(projectTemplateContentItems.sortOrder))
  let nextId = 0
  const build = buildProjectTemplateContentApplication({
    applicationId: `selection-create:${templateContentItemId}`,
    items: versionItems,
    nextId: () => `selection-create:${nextId++}`
  })
  const selection = build.selections.find(
    (candidate) => candidate.templateContentItemId === templateContentItemId
  )
  if (!selection) return null

  return {
    templateId: match.templateId,
    templateContentItemId: match.templateContentItemId,
    choiceOptions: parseTemplateChoiceOptions(selection.choiceOptionsJson)
  }
}
