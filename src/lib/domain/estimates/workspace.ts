import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm"

import { projectChangeOrders, projectContacts } from "@/db/schema"
import { projectDocuments } from "@/db/schema-documents"
import {
  estimateTermsTemplates,
  projectEstimateAcknowledgements,
  projectEstimateAssemblies,
  projectEstimateBasisDocuments,
  projectEstimateLineCostItems,
  projectEstimateLines,
  projectEstimatePhaseDescriptions,
  projectEstimateReportPhases,
  projectEstimates,
  sageTaxEntities,
} from "@/db/schema-estimates"
import { loadProjectCostCodeCatalog } from "@/lib/cost-codes/catalog-server"
import type { EstimateAccess, EstimateWorkspaceSource } from "@/lib/domain/estimates/access"
import {
  activeEstimate,
  builderFeeComparisonLines,
  estimateLineItem,
  estimateSummary,
  templateDepartment,
  templateOption,
} from "@/lib/domain/estimates/summaries"
import type {
  ProjectEstimateTermsOption,
  ProjectEstimateVersionComparison,
  ProjectEstimateWorkspace,
} from "@/lib/domain/estimates/types"
import {
  builtInEstimateTextTemplates,
  estimateClientReportMode,
  isEstimateTextTemplateType,
  mergeEstimateTextTemplates,
  type EstimateTextTemplateOption,
  type EstimateTextTemplateType,
} from "@/lib/estimates/client-report"
import { estimateFamilyKey } from "@/lib/estimates/estimate-family"
import { readEstimateMode } from "@/lib/estimates/numbering"
import { compareEstimateVersions } from "@/lib/estimates/version-comparison"
import { isInternalStaffRole } from "@/lib/user-roles"

/** Reads the estimate workspace and the version comparison. No writes. */

export async function loadProjectEstimateWorkspace(
  access: EstimateWorkspaceSource,
  projectId: string,
  estimateId: string | undefined,
  { canEdit, canDelete }: { readonly canEdit: boolean; readonly canDelete: boolean }
): Promise<ProjectEstimateWorkspace> {
  const estimateRows = await access.db
    .select()
    .from(projectEstimates)
    .where(eq(projectEstimates.projectId, projectId))
    .orderBy(
      desc(projectEstimates.versionNumber),
      desc(projectEstimates.updatedAt)
    )
  const allEstimates = estimateRows.map((row) =>
    estimateSummary(row, access.department, canEdit)
  )
  // Contract estimates, each change order's estimates and each phase
  // proposal's estimates are separate families; only the open family's
  // versions are listed.
  const requested = estimateId ? allEstimates.find((estimate) => estimate.id === estimateId) ?? null : null
  const familyChangeOrderId = requested?.changeOrderId ?? null
  const familyKey = requested ? estimateFamilyKey(requested) : "contract"
  const estimates = allEstimates.filter((estimate) => estimateFamilyKey(estimate) === familyKey)
  const selected = activeEstimate(estimates, estimateId)
  const changeOrder = familyChangeOrderId
    ? await access.db
        .select({
          id: projectChangeOrders.id,
          number: projectChangeOrders.changeOrderNumber,
          title: projectChangeOrders.title,
          status: projectChangeOrders.status,
        })
        .from(projectChangeOrders)
        .where(and(eq(projectChangeOrders.id, familyChangeOrderId), eq(projectChangeOrders.projectId, projectId)))
        .get() ?? null
    : null
  const [
    lineRows,
    costItemRows,
    basisRows,
    estimateCostCodes,
    taxRows,
    templateRows,
    phaseRows,
    reportPhaseRows,
    acknowledgementRows,
    signerContactRows,
    projectDocumentRows,
    assemblyRows,
  ] =
    await Promise.all([
      selected
        ? access.db
            .select()
            .from(projectEstimateLines)
            .where(eq(projectEstimateLines.estimateId, selected.id))
            .orderBy(
              asc(projectEstimateLines.divisionCode),
              asc(projectEstimateLines.sortOrder)
            )
        : Promise.resolve([]),
      selected
        ? access.db
            .select()
            .from(projectEstimateLineCostItems)
            .where(
              and(
                eq(projectEstimateLineCostItems.estimateId, selected.id),
                isNull(projectEstimateLineCostItems.deletedAt)
              )
            )
            .orderBy(
              asc(projectEstimateLineCostItems.estimateLineId),
              asc(projectEstimateLineCostItems.sortOrder)
            )
        : Promise.resolve([]),
      selected
        ? access.db
            .select()
            .from(projectEstimateBasisDocuments)
            .where(eq(projectEstimateBasisDocuments.estimateId, selected.id))
            .orderBy(asc(projectEstimateBasisDocuments.sortOrder))
        : Promise.resolve([]),
      loadProjectCostCodeCatalog(access.db),
      access.db
        .select()
        .from(sageTaxEntities)
        .where(eq(sageTaxEntities.active, true))
        .orderBy(asc(sageTaxEntities.name)),
      access.organizationId
        ? access.db
            .select()
            .from(estimateTermsTemplates)
            .where(
              and(
                eq(
                  estimateTermsTemplates.organizationId,
                  access.organizationId
                ),
                eq(estimateTermsTemplates.active, true)
              )
            )
            .orderBy(
              asc(estimateTermsTemplates.sortOrder),
              asc(estimateTermsTemplates.name)
            )
        : Promise.resolve([]),
      selected
        ? access.db
            .select()
            .from(projectEstimatePhaseDescriptions)
            .where(
              eq(projectEstimatePhaseDescriptions.estimateId, selected.id)
            )
            .orderBy(asc(projectEstimatePhaseDescriptions.divisionCode))
        : Promise.resolve([]),
      selected
        ? access.db.select().from(projectEstimateReportPhases)
            .where(eq(projectEstimateReportPhases.estimateId, selected.id))
            .orderBy(asc(projectEstimateReportPhases.sortOrder), asc(projectEstimateReportPhases.id))
        : Promise.resolve([]),
      selected
        ? access.db
            .select()
            .from(projectEstimateAcknowledgements)
            .where(eq(projectEstimateAcknowledgements.estimateId, selected.id))
            .orderBy(asc(projectEstimateAcknowledgements.sortOrder))
        : Promise.resolve([]),
      access.db
        .select({
          id: projectContacts.id,
          name: projectContacts.displayName,
          title: projectContacts.role,
          companyName: projectContacts.companyName,
          email: projectContacts.email,
          contactType: projectContacts.contactType,
          primaryContact: projectContacts.primaryContact,
          sortOrder: projectContacts.sortOrder,
        })
        .from(projectContacts)
        .where(
          and(
            eq(projectContacts.projectId, projectId),
            eq(projectContacts.active, true)
          )
        )
        .orderBy(
          desc(projectContacts.primaryContact),
          asc(projectContacts.sortOrder),
          asc(projectContacts.displayName)
        ),
      access.db
        .select({
          id: projectDocuments.id,
          category: projectDocuments.category,
          title: projectDocuments.title,
          documentDate: projectDocuments.documentDate,
          revision: projectDocuments.revision,
          status: projectDocuments.status,
          sourceUrl: projectDocuments.sourceUrl,
        })
        .from(projectDocuments)
        .where(
          and(
            eq(projectDocuments.projectId, projectId),
            inArray(projectDocuments.status, ["current", "superseded"])
          )
        )
        .orderBy(
          asc(projectDocuments.category),
          desc(projectDocuments.documentDate),
          asc(projectDocuments.title)
        ),
      selected
        ? access.db.select().from(projectEstimateAssemblies)
            .where(eq(projectEstimateAssemblies.estimateId, selected.id))
            .orderBy(asc(projectEstimateAssemblies.sortOrder))
        : Promise.resolve([]),
    ])

  const costItemsByLine = new Map<
    string,
    (typeof projectEstimateLineCostItems.$inferSelect)[]
  >()
  for (const costItem of costItemRows) {
    const items = costItemsByLine.get(costItem.estimateLineId) ?? []
    items.push(costItem)
    costItemsByLine.set(costItem.estimateLineId, items)
  }

  const databaseTemplates = templateRows.flatMap(
    (row): readonly EstimateTextTemplateOption[] => {
      if (!isEstimateTextTemplateType(row.templateType)) return []
      const departmentCode = templateDepartment(row.departmentCode)
      if (departmentCode !== null && departmentCode !== access.department) {
        return []
      }
      return [
        {
          id: row.id,
          name: row.name,
          departmentCode,
          templateType: row.templateType,
          body: row.body,
          sourceDocumentId: row.sourceDocumentId,
          sourceUrl: row.sourceUrl,
        },
      ]
    }
  )
  const availableTemplates = mergeEstimateTextTemplates({
    organizationTemplates: databaseTemplates,
    builtInTemplates: builtInEstimateTextTemplates({
      department: access.department,
    }),
  })
  const templatesByType = (
    templateType: EstimateTextTemplateType
  ): readonly ProjectEstimateTermsOption[] =>
    availableTemplates
      .filter((template) => template.templateType === templateType)
      .map(templateOption)

  return {
    canEdit,
    canDelete,
    projectNumber: access.projectNumber,
    projectName: access.projectName,
    projectAddress: access.projectAddress,
    projectMailingAddress: access.projectMailingAddress,
    department: access.department,
    estimateMode: await readEstimateMode(access.db, access.organizationId, access.department),
    reportMode:
      selected?.clientReportMode ?? estimateClientReportMode(access.department),
    estimates,
    activeEstimate: selected,
    changeOrder,
    assemblies: assemblyRows.map(({ id, name, description, sortOrder, clientDetail }) => ({ id, name, description, sortOrder, clientDetail })),
    lines: lineRows.map((row) =>
      estimateLineItem(row, costItemsByLine.get(row.id) ?? [])
    ),
    basisDocuments: basisRows.map((row) => ({
      id: row.id,
      projectDocumentId: row.projectDocumentId,
      documentType: row.documentType,
      title: row.title,
      documentDate: row.documentDate,
      revision: row.revision,
      driveUrl: row.driveUrl,
      notes: row.notes,
      sortOrder: row.sortOrder,
    })),
    projectDocumentOptions: projectDocumentRows,
    costCodes: [
      ...estimateCostCodes.map((row) => ({
        value: row.code,
        label: row.sageMapped
          ? row.displayLabel
          : `${row.displayLabel} · Sage mapping required`,
        description: row.description,
        divisionCode: row.divisionCode,
        divisionName: row.divisionDescription,
        divisionLabel: row.divisionDisplayLabel,
        sageMapped: row.sageMapped,
      })),
    ],
    taxEntities: taxRows.map((row) => ({
      value: row.id,
      label: `${row.code} · ${row.name}`,
      code: row.code,
      rateBasisPoints: row.rateBasisPoints,
    })),
    termsTemplates: templatesByType("terms"),
    introductionTemplates: templatesByType("introduction"),
    closingTemplates: templatesByType("closing"),
    acknowledgementTemplates: templatesByType("acknowledgement"),
    phaseDescriptions: phaseRows.map((row) => ({
      divisionCode: row.divisionCode,
      description: row.description,
    })),
    reportPhases: reportPhaseRows.map((row) => ({
      id: row.id,
      divisionCode: row.divisionCode,
      name: row.name,
      description: row.description,
      itemize: row.itemize,
      sortOrder: row.sortOrder,
    })),
    selectedAcknowledgements: acknowledgementRows.map((row) => ({
      id: row.id,
      templateId: row.templateId,
      title: row.title,
      body: row.body,
      sourceDocumentId: row.sourceDocumentId,
      sourceUrl: row.sourceUrl,
      sortOrder: row.sortOrder,
    })),
    signerContacts: signerContactRows.map((row) => ({
      id: row.id,
      name: row.name,
      title: row.title,
      companyName: row.companyName,
      email: row.email,
      contactType: row.contactType,
    })),
  }
}

export async function loadProjectEstimateVersionComparison(
  access: EstimateAccess,
  projectId: string,
  baseEstimateId?: string,
  revisedEstimateId?: string
): Promise<ProjectEstimateVersionComparison> {
  const estimateRows = await access.db
    .select()
    .from(projectEstimates)
    .where(eq(projectEstimates.projectId, projectId))
    .orderBy(
      desc(projectEstimates.versionNumber),
      desc(projectEstimates.updatedAt)
    )
  const canEdit = isInternalStaffRole(access.user.role)
  const allEstimates = estimateRows.map((row) =>
    estimateSummary(row, access.department, canEdit)
  )
  // Compare within one family: the contract estimate's versions, or one
  // change order's estimate versions.
  const requestedRevised = allEstimates.find((estimate) => estimate.id === revisedEstimateId) ?? null
  const familyKey = requestedRevised ? estimateFamilyKey(requestedRevised) : "contract"
  const estimates = allEstimates.filter((estimate) => estimateFamilyKey(estimate) === familyKey)
  const revisedEstimate =
    estimates.find((estimate) => estimate.id === revisedEstimateId) ??
    estimates[0] ??
    null
  const baseEstimate =
    estimates.find(
      (estimate) =>
        estimate.id === baseEstimateId && estimate.id !== revisedEstimate?.id
    ) ??
    estimates.find((estimate) => estimate.id !== revisedEstimate?.id) ??
    null
  const selectedIds = [baseEstimate?.id, revisedEstimate?.id].filter(
    (id): id is string => Boolean(id)
  )
  const lineRows =
    selectedIds.length === 2
      ? await access.db
          .select()
          .from(projectEstimateLines)
          .where(
            and(
              eq(projectEstimateLines.projectId, projectId),
              inArray(projectEstimateLines.estimateId, selectedIds)
            )
          )
          .orderBy(
            asc(projectEstimateLines.divisionCode),
            asc(projectEstimateLines.sortOrder)
          )
      : []
  const comparison =
    baseEstimate && revisedEstimate
      ? compareEstimateVersions({
          baseLines: [
            ...lineRows.filter((line) => line.estimateId === baseEstimate.id),
            ...builderFeeComparisonLines(baseEstimate),
          ],
          revisedLines: [
            ...lineRows.filter((line) => line.estimateId === revisedEstimate.id),
            ...builderFeeComparisonLines(revisedEstimate),
          ],
        })
      : null

  return {
    canEdit,
    projectNumber: access.projectNumber,
    projectName: access.projectName,
    estimates,
    baseEstimate,
    revisedEstimate,
    comparison,
  }
}
