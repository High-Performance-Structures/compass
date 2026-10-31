import { and, asc, eq } from "drizzle-orm"

import { projects } from "@/db/schema"
import { sageTaxEntities } from "@/db/schema-estimates"
import {
  estimateTemplateDefaults,
  estimateTemplateLines,
  projectTemplates,
  projectTemplateVersions,
} from "@/db/schema-templates"
import {
  insertTemplateEstimateLineStatement,
  insertTemplateEstimateStatement,
} from "@/lib/domain/estimates/store"
import { estimateTitleForDepartment } from "@/lib/estimates/client-report"
import { numberNewEstimate, readEstimateMode } from "@/lib/estimates/numbering"
import { projectDepartment } from "@/lib/project-branding"
import type { Db } from "@/lib/server/action-context"
import { cleanText } from "@/lib/shared/guards"
import {
  buildEstimateTemplateApplication,
  type EstimateTemplateSourceLine,
} from "@/lib/templates/estimate-template-application"

import {
  completeTemplateApplicationStatement,
  insertEstimateTemplateApplicationStatement,
} from "./store"

/*
 * Creates a draft project estimate from a published estimate template. The
 * application record, estimate, lines and completion are one atomic D1
 * batch, with the SQL the action always used. Totals come from the stored
 * template lines through buildEstimateTemplateApplication. Callers check
 * project access first; errors are thrown with the action's messages.
 */

export type EstimateFromTemplate = {
  readonly estimateId: string
  readonly templateId: string
  readonly templateName: string
  readonly versionNumber: number
  readonly lineCount: number
}

export async function createEstimateFromTemplate(
  context: {
    readonly db: Db
    readonly rawDb: D1Database
    readonly organizationId: string
    readonly userId: string
  },
  input: {
    readonly projectId: string
    readonly templateId: string
    readonly defaultTaxEntityId: string | null
  }
): Promise<EstimateFromTemplate> {
  const { db, rawDb, organizationId } = context
  const project = await db
    .select({
      id: projects.id,
      projectNumber: projects.projectNumber,
      organizationId: projects.organizationId,
    })
    .from(projects)
    .where(and(eq(projects.id, input.projectId), eq(projects.organizationId, organizationId)))
    .get()
  if (!project) throw new Error("Project not found or access denied.")
  const template = await db
    .select()
    .from(projectTemplates)
    .where(
      and(
        eq(projectTemplates.id, input.templateId),
        eq(projectTemplates.organizationId, organizationId),
        eq(projectTemplates.templateKind, "estimate"),
        eq(projectTemplates.lifecycleStatus, "active"),
        eq(projectTemplates.reviewStatus, "verified")
      )
    )
    .get()
  if (!template || template.currentVersionNumber === null) {
    throw new Error("Choose a published estimate template.")
  }
  const version = await db
    .select()
    .from(projectTemplateVersions)
    .where(
      and(
        eq(projectTemplateVersions.templateId, template.id),
        eq(projectTemplateVersions.versionNumber, template.currentVersionNumber),
        eq(projectTemplateVersions.status, "published")
      )
    )
    .get()
  if (!version) throw new Error("The estimate template is not published.")
  const [defaults, sourceLines, taxEntities] = await Promise.all([
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
    db.select().from(sageTaxEntities).where(eq(sageTaxEntities.active, true)),
  ])
  if (!defaults) throw new Error("The estimate template defaults are missing.")
  const defaultTax = cleanText(input.defaultTaxEntityId)
    ? taxEntities.find((tax) => tax.id === input.defaultTaxEntityId) ?? null
    : null
  if (input.defaultTaxEntityId && !defaultTax) {
    throw new Error("Choose an active Sage tax entity.")
  }
  const application = buildEstimateTemplateApplication({
    lines: sourceLines.map(
      (line): EstimateTemplateSourceLine => ({
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
      })
    ),
    taxEntities: taxEntities.map((tax) => ({
      id: tax.id,
      code: tax.code,
      name: tax.name,
      rateBasisPoints: tax.rateBasisPoints,
    })),
    defaultTaxEntityId: defaultTax?.id ?? null,
  })
  if (!application.success) throw new Error(application.error)

  const estimateId = crypto.randomUUID()
  const applicationId = crypto.randomUUID()
  const now = new Date().toISOString()
  const estimateDate = now.slice(0, 10)
  const department = projectDepartment({
    projectId: project.id,
    projectNumber: project.projectNumber,
  })
  // A department with several estimates per job starts a new estimate
  // number; otherwise this is the job's next version.
  const numbering = await numberNewEstimate(db, {
    projectId: input.projectId,
    projectNumber: project.projectNumber,
    mode: await readEstimateMode(db, organizationId, department),
  })
  const documentTitle = estimateTitleForDepartment({
    department,
    requestedTitle: defaults.documentTitle,
  })
  const { totals } = application.data
  const statements: D1PreparedStatement[] = [
    insertEstimateTemplateApplicationStatement(rawDb, {
      id: applicationId,
      organizationId,
      projectId: input.projectId,
      templateId: template.id,
      versionId: version.id,
      anchorDate: estimateDate,
      appliedBy: context.userId,
      itemCount: application.data.lines.length,
      optionsJson: JSON.stringify({ moduleType: "estimate" }),
      now,
    }),
    insertTemplateEstimateStatement(rawDb, {
      id: estimateId,
      projectId: input.projectId,
      estimateNumber: numbering.estimateNumber,
      versionNumber: numbering.versionNumber,
      title: documentTitle,
      estimateDate,
      sourceRevision: `${template.name} v${version.versionNumber}`,
      templateVersionId: version.id,
      templateApplicationId: applicationId,
      defaultTaxEntityId: defaultTax?.id ?? null,
      defaultTaxCode: defaultTax?.code ?? null,
      defaultTaxName: defaultTax?.name ?? null,
      defaultTaxRateBasisPoints: defaultTax?.rateBasisPoints ?? 0,
      contractTerms: defaults.contractTerms,
      directCostCents: totals.directCostCents,
      markupCents: totals.markupCents,
      taxCents: totals.taxCents,
      builderFeeBaseCents: totals.builderFeeBaseCents,
      estimateTotalCents: totals.estimateTotalCents,
      createdBy: context.userId,
      now,
    }),
  ]
  for (const line of application.data.lines) {
    statements.push(
      insertTemplateEstimateLineStatement(rawDb, {
        ...line,
        id: crypto.randomUUID(),
        projectId: input.projectId,
        estimateId,
        now,
      })
    )
  }
  statements.push(completeTemplateApplicationStatement(rawDb, applicationId, now))
  const results = await rawDb.batch(statements)
  if (results.some((result) => !result.success)) {
    throw new Error("Estimate template application failed.")
  }
  return {
    estimateId,
    templateId: template.id,
    templateName: template.name,
    versionNumber: version.versionNumber,
    lineCount: application.data.lines.length,
  }
}
