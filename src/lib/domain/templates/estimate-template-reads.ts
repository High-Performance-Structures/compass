import { and, asc, desc, eq, inArray } from "drizzle-orm"

import { sageCostCodes } from "@/db/schema"
import { sageTaxEntities } from "@/db/schema-estimates"
import {
  estimateTemplateDefaults,
  estimateTemplateLines,
  projectTemplates,
  projectTemplateVersions,
} from "@/db/schema-templates"
import { CONTRACT_ADJUSTMENT_COST_CODES } from "@/lib/financials/project-totals-import"
import type { Db } from "@/lib/server/action-context"

import type { EstimateTemplateEditor, EstimateTemplateOption } from "./types"

/*
 * Reads for estimate templates, scoped to one organization in SQL. Moved
 * unchanged from the estimate template actions.
 */

type TemplateRow = typeof projectTemplates.$inferSelect
type VersionRow = typeof projectTemplateVersions.$inferSelect

/** The organization's estimate template with this id, or undefined. */
export async function findEstimateTemplate(
  db: Db,
  organizationId: string,
  templateId: string
): Promise<TemplateRow | undefined> {
  return db
    .select()
    .from(projectTemplates)
    .where(
      and(
        eq(projectTemplates.id, templateId),
        eq(projectTemplates.organizationId, organizationId),
        eq(projectTemplates.templateKind, "estimate")
      )
    )
    .get()
}

/** The template's highest-numbered version, or null. */
export async function latestTemplateVersion(db: Db, templateId: string): Promise<VersionRow | null> {
  return db
    .select()
    .from(projectTemplateVersions)
    .where(eq(projectTemplateVersions.templateId, templateId))
    .orderBy(desc(projectTemplateVersions.versionNumber))
    .limit(1)
    .then((rows) => rows[0] ?? null)
}

/** The template and its draft version; throws the editor's messages otherwise. */
export async function editableTemplateVersion(
  db: Db,
  organizationId: string,
  templateId: string
): Promise<{ readonly template: TemplateRow; readonly version: VersionRow }> {
  const template = await findEstimateTemplate(db, organizationId, templateId)
  if (!template) throw new Error("Estimate template not found.")
  const version = await latestTemplateVersion(db, template.id)
  if (!version) throw new Error("Estimate template version not found.")
  if (version.status !== "draft") {
    throw new Error("Create a new revision before editing this published template.")
  }
  return { template, version }
}

export async function loadPublishedEstimateTemplateOptions(
  db: Db,
  organizationId: string
): Promise<readonly EstimateTemplateOption[]> {
  const templates = await db
    .select()
    .from(projectTemplates)
    .where(
      and(
        eq(projectTemplates.organizationId, organizationId),
        eq(projectTemplates.templateKind, "estimate"),
        eq(projectTemplates.lifecycleStatus, "active"),
        eq(projectTemplates.reviewStatus, "verified")
      )
    )
    .orderBy(asc(projectTemplates.name))
  const versionNumbers = templates.flatMap((template) =>
    template.currentVersionNumber === null
      ? []
      : [{ templateId: template.id, versionNumber: template.currentVersionNumber }]
  )
  if (versionNumbers.length === 0) return []
  const versions = await db
    .select()
    .from(projectTemplateVersions)
    .where(
      inArray(
        projectTemplateVersions.templateId,
        versionNumbers.map((item) => item.templateId)
      )
    )
  const published = versions.filter((version) =>
    versionNumbers.some(
      (item) =>
        item.templateId === version.templateId &&
        item.versionNumber === version.versionNumber &&
        version.status === "published"
    )
  )
  const lines = published.length
    ? await db
        .select({
          versionId: estimateTemplateLines.versionId,
          taxable: estimateTemplateLines.taxable,
          taxCode: estimateTemplateLines.taxCode,
        })
        .from(estimateTemplateLines)
        .where(
          inArray(
            estimateTemplateLines.versionId,
            published.map((version) => version.id)
          )
        )
    : []

  return templates.flatMap((template) => {
    const version = published.find((candidate) => candidate.templateId === template.id)
    if (!version) return []
    return [
      {
        id: template.id,
        name: template.name,
        description: template.description,
        versionNumber: version.versionNumber,
        lineCount: lines.filter((line) => line.versionId === version.id).length,
        requiresProjectTaxEntity: lines.some(
          (line) => line.versionId === version.id && line.taxable && !line.taxCode
        ),
      },
    ]
  })
}

export async function loadEstimateTemplateEditor(
  db: Db,
  organizationId: string,
  templateId: string,
  canEdit: boolean
): Promise<EstimateTemplateEditor | null> {
  const template = await findEstimateTemplate(db, organizationId, templateId)
  if (!template) return null
  const version = await latestTemplateVersion(db, template.id)
  if (!version) return null

  const [defaults, lines, costCodes, taxCodes] = await Promise.all([
    db
      .select()
      .from(estimateTemplateDefaults)
      .where(eq(estimateTemplateDefaults.versionId, version.id))
      .get(),
    db
      .select()
      .from(estimateTemplateLines)
      .where(eq(estimateTemplateLines.versionId, version.id))
      .orderBy(asc(estimateTemplateLines.divisionCode), asc(estimateTemplateLines.sortOrder)),
    db
      .select()
      .from(sageCostCodes)
      .where(eq(sageCostCodes.active, true))
      .orderBy(asc(sageCostCodes.divisionCode), asc(sageCostCodes.displayLabel)),
    db
      .select()
      .from(sageTaxEntities)
      .where(eq(sageTaxEntities.active, true))
      .orderBy(asc(sageTaxEntities.name)),
  ])
  if (!defaults) return null

  return {
    canEdit,
    id: template.id,
    name: template.name,
    description: template.description,
    lifecycleStatus: template.lifecycleStatus,
    reviewStatus: template.reviewStatus,
    versionId: version.id,
    versionNumber: version.versionNumber,
    versionStatus: version.status,
    documentTitle: defaults.documentTitle,
    contractTerms: defaults.contractTerms,
    defaultMarkupRateBasisPoints: defaults.defaultMarkupRateBasisPoints,
    lines: lines.map((line) => ({
      id: line.id,
      divisionCode: line.divisionCode,
      divisionName: line.divisionName,
      costCode: line.costCode,
      costCodeName: line.costCodeName,
      description: line.description,
      specifications: line.specifications,
      quantity: line.quantity,
      unit: line.unit,
      unitCostCents: line.unitCostCents,
      markupRateBasisPoints: line.markupRateBasisPoints,
      taxable: line.taxable,
      taxCode: line.taxCode,
      ownerVisible: line.ownerVisible,
      sortOrder: line.sortOrder,
    })),
    costCodes: [
      ...costCodes.map((costCode) => ({
        value: costCode.code,
        label: costCode.displayLabel,
        divisionCode: costCode.divisionCode,
        divisionName: costCode.divisionDescription,
      })),
      ...CONTRACT_ADJUSTMENT_COST_CODES.map((costCode) => ({
        value: costCode.value,
        label: `${costCode.value} · ${costCode.description}`,
        divisionCode: "99",
        divisionName: "Contract Adjustments",
      })),
    ],
    taxCodes: taxCodes.map((taxCode) => ({
      value: taxCode.code,
      label: `${taxCode.code} · ${taxCode.name}`,
      rateBasisPoints: taxCode.rateBasisPoints,
    })),
  }
}
