"use server"

import { and, asc, desc, eq, like, ne } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import { projectBudgetLines, projects, sageCostCodes } from "@/db/schema"
import {
  estimateTermsTemplates,
  projectEstimateAcknowledgements,
  projectEstimateBasisDocuments,
  projectEstimateLines,
  projectEstimatePhaseDescriptions,
  projectEstimates,
  sageTaxEntities,
} from "@/db/schema-estimates"
import { googleAuth } from "@/db/schema-google"
import { requireAuth, type AuthUser } from "@/lib/auth"
import { decrypt } from "@/lib/crypto"
import { getCloudflareContext } from "@/lib/db"
import { rebuildProjectContractBudget } from "@/lib/financials/contract-budget-store"
import {
  calculateEstimateLine,
  calculateEstimateTotals,
  estimateCanBeEdited,
  estimateSourceHash,
  isEstimateStatus,
  type EstimateLedgerLine,
} from "@/lib/financials/estimate-ledger"
import {
  CONTRACT_ADJUSTMENT_COST_CODES,
  parseProjectTotalsRows,
  spreadsheetIdFromUrl,
} from "@/lib/financials/project-totals-import"
import {
  builtInEstimateTextTemplates,
  defaultEstimateTitle,
  estimateClientReportMode,
  estimateTitleForDepartment,
  isEstimateTextTemplateType,
  type EstimateClientReportMode,
  type EstimateTextTemplateOption,
  type EstimateTextTemplateType,
} from "@/lib/estimates/client-report"
import {
  projectEstimateCostCodeCatalog,
  type ProjectEstimateCostCodeCatalogItem,
} from "@/lib/estimates/project-cost-code-catalog"
import { SheetsClient } from "@/lib/google/client/sheets-client"
import {
  getGoogleConfig,
  getGoogleCryptoSalt,
  parseServiceAccountKey,
} from "@/lib/google/config"
import { requirePermission } from "@/lib/permissions"
import { assertProjectAccess } from "@/lib/project-access"
import {
  projectDepartment,
  type ProjectDepartment,
} from "@/lib/project-branding"
import { isInternalStaffRole } from "@/lib/user-roles"

export type ProjectEstimateSummary = {
  readonly id: string
  readonly estimateNumber: string
  readonly versionNumber: number
  readonly title: string
  readonly status: string
  readonly estimateDate: string | null
  readonly clientName: string | null
  readonly sourceWorkbookUrl: string | null
  readonly defaultTaxEntityId: string | null
  readonly defaultTaxCode: string | null
  readonly defaultTaxName: string | null
  readonly defaultTaxRateBasisPoints: number
  readonly termsTemplateId: string | null
  readonly contractTerms: string | null
  readonly introductionTemplateId: string | null
  readonly introductionText: string | null
  readonly closingTemplateId: string | null
  readonly closingText: string | null
  readonly directCostCents: number
  readonly markupCents: number
  readonly taxCents: number
  readonly estimateTotalCents: number
  readonly foxitStatus: string
  readonly foxitEnvelopeId: string | null
  readonly signaturePackageUrl: string | null
  readonly signedAt: string | null
  readonly acceptedAt: string | null
  readonly sageStatus: string
}

export type ProjectEstimateLineItem = {
  readonly id: string
  readonly divisionCode: string
  readonly divisionName: string
  readonly costCode: string
  readonly costCodeName: string
  readonly description: string
  readonly specifications: string | null
  readonly quantity: number
  readonly unit: string
  readonly unitCostCents: number
  readonly directCostCents: number
  readonly markupRateBasisPoints: number
  readonly markupCents: number
  readonly taxable: boolean
  readonly taxEntityId: string | null
  readonly taxCode: string | null
  readonly taxName: string | null
  readonly taxRateBasisPoints: number
  readonly taxCents: number
  readonly lineTotalCents: number
  readonly ownerVisible: boolean
  readonly sortOrder: number
}

export type ProjectEstimateBasisItem = {
  readonly id: string
  readonly documentType: string
  readonly title: string
  readonly documentDate: string | null
  readonly revision: string | null
  readonly driveUrl: string | null
  readonly notes: string | null
  readonly sortOrder: number
}

export type ProjectEstimateCostCodeOption = {
  readonly value: string
  readonly label: string
  readonly description: string
  readonly divisionCode: string
  readonly divisionName: string
  readonly divisionLabel: string
}

export type ProjectEstimateTaxOption = {
  readonly value: string
  readonly label: string
  readonly code: string
  readonly rateBasisPoints: number
}

export type ProjectEstimateTermsOption = {
  readonly value: string
  readonly label: string
  readonly departmentCode: ProjectDepartment | null
  readonly templateType: EstimateTextTemplateType
  readonly body: string
  readonly sourceDocumentId: string | null
  readonly sourceUrl: string | null
}

export type ProjectEstimatePhaseDescriptionItem = {
  readonly divisionCode: string
  readonly description: string
}

export type ProjectEstimateAcknowledgementItem = {
  readonly id: string
  readonly templateId: string
  readonly title: string
  readonly body: string
  readonly sourceDocumentId: string | null
  readonly sourceUrl: string | null
  readonly sortOrder: number
}

export type ProjectEstimateWorkspace = {
  readonly canEdit: boolean
  readonly projectNumber: string | null
  readonly projectName: string
  readonly department: ProjectDepartment
  readonly reportMode: EstimateClientReportMode
  readonly estimates: readonly ProjectEstimateSummary[]
  readonly activeEstimate: ProjectEstimateSummary | null
  readonly lines: readonly ProjectEstimateLineItem[]
  readonly basisDocuments: readonly ProjectEstimateBasisItem[]
  readonly costCodes: readonly ProjectEstimateCostCodeOption[]
  readonly taxEntities: readonly ProjectEstimateTaxOption[]
  readonly termsTemplates: readonly ProjectEstimateTermsOption[]
  readonly introductionTemplates: readonly ProjectEstimateTermsOption[]
  readonly closingTemplates: readonly ProjectEstimateTermsOption[]
  readonly acknowledgementTemplates: readonly ProjectEstimateTermsOption[]
  readonly phaseDescriptions: readonly ProjectEstimatePhaseDescriptionItem[]
  readonly selectedAcknowledgements: readonly ProjectEstimateAcknowledgementItem[]
}

export type ProjectEstimateHeaderInput = {
  readonly estimateNumber: string | null
  readonly title: string | null
  readonly estimateDate: string | null
  readonly clientName: string | null
  readonly sourceWorkbookUrl: string | null
  readonly defaultTaxEntityId: string | null
  readonly termsTemplateId: string | null
  readonly contractTerms: string | null
  readonly introductionTemplateId: string | null
  readonly introductionText: string | null
  readonly closingTemplateId: string | null
  readonly closingText: string | null
}

export type ProjectEstimateLineInput = {
  readonly costCode: string | null
  readonly description: string | null
  readonly specifications: string | null
  readonly quantity: number | null
  readonly unit: string | null
  readonly unitCost: number | null
  readonly markupPercent: number | null
  readonly taxable: boolean
  readonly taxEntityId: string | null
  readonly ownerVisible: boolean
}

export type ProjectEstimateBasisInput = {
  readonly documentType: string | null
  readonly title: string | null
  readonly documentDate: string | null
  readonly revision: string | null
  readonly driveUrl: string | null
  readonly notes: string | null
}

export type ProjectEstimateActionResult =
  | { readonly success: true; readonly id: string }
  | { readonly success: false; readonly error: string }

export type ProjectEstimateImportActionResult =
  | {
      readonly success: true
      readonly id: string
      readonly lineCount: number
      readonly totalCents: number
      readonly roundingAdjustmentCents: number
      readonly missingSageMappingCount: number
    }
  | { readonly success: false; readonly error: string }

export type ProjectEstimatePlanSwiftImportLine = {
  readonly rowNumber: number
  readonly costCode: string
  readonly description: string
  readonly notes: string | null
  readonly amount: number
}

export type ProjectEstimatePlanSwiftImportInput = {
  readonly sourceFileName: string
  readonly sourceSheetName: string
  readonly lines: readonly ProjectEstimatePlanSwiftImportLine[]
}

export type ProjectEstimatePlanSwiftImportResult =
  | {
      readonly success: true
      readonly id: string
      readonly lineCount: number
      readonly totalCents: number
    }
  | { readonly success: false; readonly error: string }

const PROJECT_TOTALS_RANGE = "Project Totals!A1:AA506"

type CompassDb = ReturnType<typeof getDb>

type EstimateAccess = {
  readonly db: CompassDb
  readonly user: AuthUser
  readonly projectNumber: string | null
  readonly projectName: string
  readonly organizationId: string | null
  readonly department: ProjectDepartment
  readonly canEdit: boolean
}

async function estimateAccess(
  projectId: string,
  update: boolean
): Promise<EstimateAccess> {
  const user = await requireAuth()
  requirePermission(user, "budget", update ? "update" : "read")
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const access = await assertProjectAccess(db, user, projectId)
  const projectRows = await db
    .select({
      name: projects.name,
      organizationId: projects.organizationId,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  const project = projectRows[0]
  if (!project) throw new Error("Project not found")
  const canEdit = update && isInternalStaffRole(user.role)
  if (update && !canEdit) {
    throw new Error("Only authorized internal staff can edit estimates.")
  }
  return {
    db,
    user,
    projectNumber: access.projectNumber,
    projectName: project.name,
    organizationId: project.organizationId,
    department: projectDepartment({
      projectId,
      projectNumber: access.projectNumber,
    }),
    canEdit,
  }
}

function cleanText(value: string | null): string | null {
  const cleaned = value?.trim() ?? ""
  return cleaned.length > 0 ? cleaned : null
}

function requiredText(value: string | null, label: string): string {
  const cleaned = cleanText(value)
  if (!cleaned) throw new Error(`${label} is required.`)
  return cleaned
}

function safeUrl(value: string | null): string | null {
  const cleaned = cleanText(value)
  if (!cleaned) return null
  try {
    const url = new URL(cleaned)
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    return url.toString()
  } catch {
    return null
  }
}

function templateDepartment(value: string | null): ProjectDepartment | null {
  if (value === "O" || value === "H" || value === "N" || value === "D") {
    return value
  }
  return null
}

function templateOption(
  template: EstimateTextTemplateOption
): ProjectEstimateTermsOption {
  return {
    value: template.id,
    label: template.name,
    departmentCode: template.departmentCode,
    templateType: template.templateType,
    body: template.body,
    sourceDocumentId: template.sourceDocumentId,
    sourceUrl: template.sourceUrl,
  }
}

function estimateSummary(
  row: typeof projectEstimates.$inferSelect,
  department: ProjectDepartment
): ProjectEstimateSummary {
  return {
    id: row.id,
    estimateNumber: row.estimateNumber,
    versionNumber: row.versionNumber,
    title: estimateTitleForDepartment({
      department,
      requestedTitle: row.title,
    }),
    status: row.status,
    estimateDate: row.estimateDate,
    clientName: row.clientName,
    sourceWorkbookUrl: row.sourceWorkbookUrl,
    defaultTaxEntityId: row.defaultTaxEntityId,
    defaultTaxCode: row.defaultTaxCode,
    defaultTaxName: row.defaultTaxName,
    defaultTaxRateBasisPoints: row.defaultTaxRateBasisPoints,
    termsTemplateId: row.termsTemplateId,
    contractTerms: row.contractTerms,
    introductionTemplateId: row.introductionTemplateId,
    introductionText: row.introductionText,
    closingTemplateId: row.closingTemplateId,
    closingText: row.closingText,
    directCostCents: row.directCostCents,
    markupCents: row.markupCents,
    taxCents: row.taxCents,
    estimateTotalCents: row.estimateTotalCents,
    foxitStatus: row.foxitStatus,
    foxitEnvelopeId: row.foxitEnvelopeId,
    signaturePackageUrl: row.signaturePackageUrl,
    signedAt: row.signedAt,
    acceptedAt: row.acceptedAt,
    sageStatus: row.sageStatus,
  }
}

function estimateLineItem(
  row: typeof projectEstimateLines.$inferSelect
): ProjectEstimateLineItem {
  return {
    id: row.id,
    divisionCode: row.divisionCode,
    divisionName: row.divisionName,
    costCode: row.costCode,
    costCodeName: row.costCodeName,
    description: row.description,
    specifications: row.specifications,
    quantity: row.quantity,
    unit: row.unit,
    unitCostCents: row.unitCostCents,
    directCostCents: row.directCostCents,
    markupRateBasisPoints: row.markupRateBasisPoints,
    markupCents: row.markupCents,
    taxable: row.taxable,
    taxEntityId: row.taxEntityId,
    taxCode: row.taxCode,
    taxName: row.taxName,
    taxRateBasisPoints: row.taxRateBasisPoints,
    taxCents: row.taxCents,
    lineTotalCents: row.lineTotalCents,
    ownerVisible: row.ownerVisible,
    sortOrder: row.sortOrder,
  }
}

function ledgerLine(
  row: typeof projectEstimateLines.$inferSelect
): EstimateLedgerLine {
  return {
    id: row.id,
    divisionCode: row.divisionCode,
    divisionName: row.divisionName,
    costCode: row.costCode,
    description: row.description,
    directCostCents: row.directCostCents,
    markupCents: row.markupCents,
    taxCents: row.taxCents,
    lineTotalCents: row.lineTotalCents,
    ownerVisible: row.ownerVisible,
    sortOrder: row.sortOrder,
  }
}

function activeEstimate(
  estimates: readonly ProjectEstimateSummary[],
  estimateId?: string
): ProjectEstimateSummary | null {
  if (estimateId) {
    return estimates.find((estimate) => estimate.id === estimateId) ?? null
  }
  return (
    estimates.find((estimate) =>
      ["draft", "internal_review", "signature_pending"].includes(
        estimate.status
      )
    ) ??
    estimates.find((estimate) => estimate.status === "accepted") ??
    estimates[0] ??
    null
  )
}

function revalidateEstimate(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}/estimate`)
  revalidatePath(`/print/projects/${projectId}/estimate`)
  revalidatePath(`/dashboard/projects/${projectId}/budget`)
  revalidatePath(`/dashboard/projects/${projectId}/financials`)
  revalidatePath(`/dashboard/projects/${projectId}/preview/owner`)
}

async function requireEditableEstimate(
  db: CompassDb,
  projectId: string,
  estimateId: string
): Promise<typeof projectEstimates.$inferSelect> {
  const rows = await db
    .select()
    .from(projectEstimates)
    .where(
      and(
        eq(projectEstimates.id, estimateId),
        eq(projectEstimates.projectId, projectId)
      )
    )
    .limit(1)
  const estimate = rows[0]
  if (!estimate || !isEstimateStatus(estimate.status)) {
    throw new Error("Estimate not found.")
  }
  if (!estimateCanBeEdited(estimate.status)) {
    throw new Error(
      "This estimate is locked. Create a revision instead of changing accepted contract values."
    )
  }
  return estimate
}

async function refreshEstimateTotals(
  db: CompassDb,
  estimateId: string,
  now: string
): Promise<void> {
  const rows = await db
    .select()
    .from(projectEstimateLines)
    .where(eq(projectEstimateLines.estimateId, estimateId))
  const totals = calculateEstimateTotals(rows.map(ledgerLine))
  await db
    .update(projectEstimates)
    .set({ ...totals, updatedAt: now })
    .where(eq(projectEstimates.id, estimateId))
    .run()
}

async function loadProjectEstimateCostCodes(
  db: CompassDb
): Promise<readonly ProjectEstimateCostCodeCatalogItem[]> {
  const [sageRows, namedSageRows] = await Promise.all([
    db
      .select()
      .from(sageCostCodes)
      .where(eq(sageCostCodes.active, true))
      .orderBy(
        asc(sageCostCodes.divisionCode),
        asc(sageCostCodes.displayLabel)
      ),
    db
      .select({
        sourceSystem: projectBudgetLines.sourceSystem,
        costCode: projectBudgetLines.costCode,
        description: projectBudgetLines.description,
        divisionName: projectBudgetLines.csiDivisionName,
      })
      .from(projectBudgetLines)
      .where(
        and(
          eq(projectBudgetLines.sourceSystem, "sage_read_snapshot"),
          like(projectBudgetLines.description, "01 %")
        )
      )
      .groupBy(
        projectBudgetLines.sourceSystem,
        projectBudgetLines.costCode,
        projectBudgetLines.description,
        projectBudgetLines.csiDivisionName
      )
      .orderBy(asc(projectBudgetLines.description)),
  ])

  return projectEstimateCostCodeCatalog(sageRows, namedSageRows)
}

async function loadEstimateTextTemplate(input: {
  readonly db: CompassDb
  readonly organizationId: string | null
  readonly department: ProjectDepartment
  readonly templateId: string | null
  readonly templateType: EstimateTextTemplateType
}): Promise<{ readonly id: string | null; readonly body: string } | null> {
  if (!input.templateId) return null
  const builtInTemplate = builtInEstimateTextTemplates({
    department: input.department,
    templateType: input.templateType,
  }).find((template) => template.id === input.templateId)
  if (builtInTemplate) {
    // Built-ins are code-backed rather than database rows, so only snapshot
    // their body onto the estimate and leave the foreign key unset.
    return { id: null, body: builtInTemplate.body }
  }
  if (!input.organizationId) {
    throw new Error("The project organization is required for text templates.")
  }
  const rows = await input.db
    .select()
    .from(estimateTermsTemplates)
    .where(
      and(
        eq(estimateTermsTemplates.id, input.templateId),
        eq(estimateTermsTemplates.organizationId, input.organizationId),
        eq(estimateTermsTemplates.active, true)
      )
    )
    .limit(1)
  const template = rows[0]
  if (
    !template ||
    template.templateType !== input.templateType ||
    (template.departmentCode !== null &&
      template.departmentCode !== input.department)
  ) {
    throw new Error(`Choose an available ${input.templateType} template.`)
  }
  return template
}

export async function getProjectEstimateWorkspace(
  projectId: string,
  estimateId?: string
): Promise<ProjectEstimateWorkspace> {
  const access = await estimateAccess(projectId, false)
  const canEdit = isInternalStaffRole(access.user.role)
  const estimateRows = await access.db
    .select()
    .from(projectEstimates)
    .where(eq(projectEstimates.projectId, projectId))
    .orderBy(
      desc(projectEstimates.versionNumber),
      desc(projectEstimates.updatedAt)
    )
  const estimates = estimateRows.map((row) =>
    estimateSummary(row, access.department)
  )
  const selected = activeEstimate(estimates, estimateId)
  const [
    lineRows,
    basisRows,
    estimateCostCodes,
    taxRows,
    templateRows,
    phaseRows,
    acknowledgementRows,
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
            .from(projectEstimateBasisDocuments)
            .where(eq(projectEstimateBasisDocuments.estimateId, selected.id))
            .orderBy(asc(projectEstimateBasisDocuments.sortOrder))
        : Promise.resolve([]),
      loadProjectEstimateCostCodes(access.db),
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
        ? access.db
            .select()
            .from(projectEstimateAcknowledgements)
            .where(eq(projectEstimateAcknowledgements.estimateId, selected.id))
            .orderBy(asc(projectEstimateAcknowledgements.sortOrder))
        : Promise.resolve([]),
    ])

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
  const availableTemplates = [
    ...databaseTemplates,
    ...builtInEstimateTextTemplates({ department: access.department }),
  ]
  const templatesByType = (
    templateType: EstimateTextTemplateType
  ): readonly ProjectEstimateTermsOption[] =>
    availableTemplates
      .filter((template) => template.templateType === templateType)
      .map(templateOption)

  return {
    canEdit,
    projectNumber: access.projectNumber,
    projectName: access.projectName,
    department: access.department,
    reportMode: estimateClientReportMode(access.department),
    estimates,
    activeEstimate: selected,
    lines: lineRows.map(estimateLineItem),
    basisDocuments: basisRows.map((row) => ({
      id: row.id,
      documentType: row.documentType,
      title: row.title,
      documentDate: row.documentDate,
      revision: row.revision,
      driveUrl: row.driveUrl,
      notes: row.notes,
      sortOrder: row.sortOrder,
    })),
    costCodes: [
      ...estimateCostCodes.map((row) => ({
        value: row.code,
        label: row.displayLabel,
        description: row.description,
        divisionCode: row.divisionCode,
        divisionName: row.divisionDescription,
        divisionLabel: row.divisionDisplayLabel,
      })),
      ...CONTRACT_ADJUSTMENT_COST_CODES.map((item) => ({
        value: item.value,
        label: `${item.value} · ${item.description} · contract adjustment — not Sage mapped`,
        description: item.description,
        divisionCode: "99",
        divisionName: "Contract Adjustments",
        divisionLabel: "99 · Contract Adjustments",
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
    selectedAcknowledgements: acknowledgementRows.map((row) => ({
      id: row.id,
      templateId: row.templateId,
      title: row.title,
      body: row.body,
      sourceDocumentId: row.sourceDocumentId,
      sourceUrl: row.sourceUrl,
      sortOrder: row.sortOrder,
    })),
  }
}

export async function createProjectEstimateDraft(
  projectId: string
): Promise<ProjectEstimateActionResult> {
  try {
    const access = await estimateAccess(projectId, true)
    const prior = await access.db
      .select({ versionNumber: projectEstimates.versionNumber })
      .from(projectEstimates)
      .where(eq(projectEstimates.projectId, projectId))
      .orderBy(desc(projectEstimates.versionNumber))
      .limit(1)
    const versionNumber = (prior[0]?.versionNumber ?? 0) + 1
    const estimateNumber = `${access.projectNumber ?? "PROJECT"}-00`
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    await access.db.insert(projectEstimates).values({
      id,
      projectId,
      estimateNumber,
      versionNumber,
      title: defaultEstimateTitle(access.department),
      status: "draft",
      estimateDate: now.slice(0, 10),
      sourceSystem: "compass",
      createdBy: access.user.id,
      createdAt: now,
      updatedAt: now,
    })
    revalidateEstimate(projectId)
    return { success: true, id }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Unable to create estimate.",
    }
  }
}

export async function updateProjectEstimateHeader(
  projectId: string,
  estimateId: string,
  input: ProjectEstimateHeaderInput
): Promise<ProjectEstimateActionResult> {
  try {
    const access = await estimateAccess(projectId, true)
    await requireEditableEstimate(access.db, projectId, estimateId)
    const taxEntityRows = input.defaultTaxEntityId
      ? await access.db
          .select()
          .from(sageTaxEntities)
          .where(eq(sageTaxEntities.id, input.defaultTaxEntityId))
          .limit(1)
      : []
    const taxEntity = taxEntityRows[0]
    const [termsTemplate, introductionTemplate, closingTemplate] =
      await Promise.all([
        loadEstimateTextTemplate({
          db: access.db,
          organizationId: access.organizationId,
          department: access.department,
          templateId: input.termsTemplateId,
          templateType: "terms",
        }),
        loadEstimateTextTemplate({
          db: access.db,
          organizationId: access.organizationId,
          department: access.department,
          templateId: input.introductionTemplateId,
          templateType: "introduction",
        }),
        loadEstimateTextTemplate({
          db: access.db,
          organizationId: access.organizationId,
          department: access.department,
          templateId: input.closingTemplateId,
          templateType: "closing",
        }),
      ])
    const contractTerms =
      cleanText(input.contractTerms) ?? termsTemplate?.body ?? null
    const introductionText =
      cleanText(input.introductionText) ?? introductionTemplate?.body ?? null
    const closingText =
      cleanText(input.closingText) ?? closingTemplate?.body ?? null
    await access.db
      .update(projectEstimates)
      .set({
        estimateNumber: requiredText(input.estimateNumber, "Estimate number"),
        title: requiredText(input.title, "Estimate title"),
        estimateDate: cleanText(input.estimateDate),
        clientName: cleanText(input.clientName),
        sourceWorkbookUrl: safeUrl(input.sourceWorkbookUrl),
        defaultTaxEntityId: taxEntity?.id ?? null,
        defaultTaxCode: taxEntity?.code ?? null,
        defaultTaxName: taxEntity?.name ?? null,
        defaultTaxRateBasisPoints: taxEntity?.rateBasisPoints ?? 0,
        termsTemplateId: termsTemplate?.id ?? null,
        contractTerms,
        introductionTemplateId: introductionTemplate?.id ?? null,
        introductionText,
        closingTemplateId: closingTemplate?.id ?? null,
        closingText,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(projectEstimates.id, estimateId))
      .run()
    revalidateEstimate(projectId)
    return { success: true, id: estimateId }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Unable to save estimate.",
    }
  }
}

export async function saveProjectEstimatePhaseDescription(
  projectId: string,
  estimateId: string,
  input: {
    readonly divisionCode: string | null
    readonly description: string | null
  }
): Promise<ProjectEstimateActionResult> {
  try {
    const access = await estimateAccess(projectId, true)
    await requireEditableEstimate(access.db, projectId, estimateId)
    const divisionCode = requiredText(input.divisionCode, "Phase")
    const matchingLine = await access.db
      .select({ id: projectEstimateLines.id })
      .from(projectEstimateLines)
      .where(
        and(
          eq(projectEstimateLines.estimateId, estimateId),
          eq(projectEstimateLines.divisionCode, divisionCode)
        )
      )
      .limit(1)
    if (!matchingLine[0]) {
      throw new Error("Choose a phase used by this estimate.")
    }
    const description = cleanText(input.description)
    if (!description) {
      await access.db
        .delete(projectEstimatePhaseDescriptions)
        .where(
          and(
            eq(projectEstimatePhaseDescriptions.estimateId, estimateId),
            eq(projectEstimatePhaseDescriptions.divisionCode, divisionCode)
          )
        )
        .run()
      revalidateEstimate(projectId)
      return { success: true, id: estimateId }
    }
    const now = new Date().toISOString()
    await access.db
      .insert(projectEstimatePhaseDescriptions)
      .values({
        id: crypto.randomUUID(),
        projectId,
        estimateId,
        divisionCode,
        description,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          projectEstimatePhaseDescriptions.estimateId,
          projectEstimatePhaseDescriptions.divisionCode,
        ],
        set: { description, updatedAt: now },
      })
      .run()
    revalidateEstimate(projectId)
    return { success: true, id: estimateId }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to save the phase description.",
    }
  }
}

export async function setProjectEstimateAcknowledgements(
  projectId: string,
  estimateId: string,
  templateIds: readonly string[]
): Promise<ProjectEstimateActionResult> {
  try {
    const access = await estimateAccess(projectId, true)
    await requireEditableEstimate(access.db, projectId, estimateId)
    if (access.department !== "N") {
      throw new Error("Acknowledgements are available for Nu-Tech estimates.")
    }
    const uniqueTemplateIds = [...new Set(templateIds)].slice(0, 10)
    const databaseRows = access.organizationId
      ? await access.db
          .select()
          .from(estimateTermsTemplates)
          .where(
            and(
              eq(
                estimateTermsTemplates.organizationId,
                access.organizationId
              ),
              eq(estimateTermsTemplates.active, true),
              eq(estimateTermsTemplates.templateType, "acknowledgement")
            )
          )
      : []
    const databaseTemplates = databaseRows.flatMap(
      (row): readonly EstimateTextTemplateOption[] => {
        const departmentCode = templateDepartment(row.departmentCode)
        if (departmentCode !== null && departmentCode !== access.department) {
          return []
        }
        return [
          {
            id: row.id,
            name: row.name,
            departmentCode,
            templateType: "acknowledgement",
            body: row.body,
            sourceDocumentId: row.sourceDocumentId,
            sourceUrl: row.sourceUrl,
          },
        ]
      }
    )
    const availableTemplates = [
      ...databaseTemplates,
      ...builtInEstimateTextTemplates({
        department: access.department,
        templateType: "acknowledgement",
      }),
    ]
    const selectedTemplates = uniqueTemplateIds.map((templateId) => {
      const template = availableTemplates.find(
        (candidate) => candidate.id === templateId
      )
      if (!template) throw new Error("Choose an available acknowledgement.")
      return template
    })
    const now = new Date().toISOString()
    await access.db
      .delete(projectEstimateAcknowledgements)
      .where(eq(projectEstimateAcknowledgements.estimateId, estimateId))
      .run()
    if (selectedTemplates.length > 0) {
      await access.db
        .insert(projectEstimateAcknowledgements)
        .values(
          selectedTemplates.map((template, sortOrder) => ({
            id: crypto.randomUUID(),
            projectId,
            estimateId,
            templateId: template.id,
            title: template.name,
            body: template.body,
            sourceDocumentId: template.sourceDocumentId,
            sourceUrl: template.sourceUrl,
            sortOrder,
            createdAt: now,
            updatedAt: now,
          }))
        )
        .run()
    }
    revalidateEstimate(projectId)
    return { success: true, id: estimateId }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to save acknowledgements.",
    }
  }
}

export async function saveEstimateTextTemplate(
  projectId: string,
  input: {
    readonly name: string | null
    readonly templateType: string | null
    readonly body: string | null
    readonly sourceUrl: string | null
  }
): Promise<ProjectEstimateActionResult> {
  try {
    const access = await estimateAccess(projectId, true)
    if (!access.organizationId) {
      throw new Error("The project organization is required for templates.")
    }
    const name = requiredText(input.name, "Template name")
    const templateType = requiredText(input.templateType, "Template type")
    if (!isEstimateTextTemplateType(templateType)) {
      throw new Error("Choose a supported estimate text template type.")
    }
    const body = requiredText(input.body, "Template text")
    const sourceUrl = safeUrl(input.sourceUrl)
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    await access.db
      .insert(estimateTermsTemplates)
      .values({
        id,
        organizationId: access.organizationId,
        name,
        departmentCode: access.department,
        templateType,
        body,
        sourceUrl,
        active: true,
        createdBy: access.user.id,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          estimateTermsTemplates.organizationId,
          estimateTermsTemplates.departmentCode,
          estimateTermsTemplates.templateType,
          estimateTermsTemplates.name,
        ],
        set: { body, sourceUrl, active: true, updatedAt: now },
      })
      .run()
    revalidateEstimate(projectId)
    return { success: true, id }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to save the estimate text template.",
    }
  }
}

export async function importProjectEstimateFromGoogleSheet(
  projectId: string,
  estimateId: string
): Promise<ProjectEstimateImportActionResult> {
  try {
    const access = await estimateAccess(projectId, true)
    const estimate = await requireEditableEstimate(
      access.db,
      projectId,
      estimateId
    )
    const spreadsheetId = spreadsheetIdFromUrl(estimate.sourceWorkbookUrl)
    if (!spreadsheetId) {
      throw new Error(
        "Save a valid Google Sheets Source CSI workbook before importing."
      )
    }

    const authRows = access.organizationId
      ? await access.db
          .select()
          .from(googleAuth)
          .where(eq(googleAuth.organizationId, access.organizationId))
          .limit(1)
      : await access.db.select().from(googleAuth).limit(1)
    const auth = authRows[0]
    if (!auth) {
      throw new Error("Google Workspace service account is not connected.")
    }

    const { env } = await getCloudflareContext()
    const config = getGoogleConfig(env)
    const keyJson = await decrypt(
      auth.serviceAccountKeyEncrypted,
      config.encryptionKey,
      getGoogleCryptoSalt()
    )
    const client = new SheetsClient(parseServiceAccountKey(keyJson))
    const googleEmail = access.user.googleEmail ?? access.user.email
    const rows = await client.getValues(googleEmail, {
      spreadsheetId,
      range: PROJECT_TOTALS_RANGE,
      valueRenderOption: "UNFORMATTED_VALUE",
    })
    const parsed = parseProjectTotalsRows(rows)
    if (!parsed.success) throw new Error(parsed.error)

    const sourceCostCodes = parsed.lines
      .filter((line) => line.divisionCode !== "99")
      .map((line) => line.costCode)
    const costCodeCatalog = await loadProjectEstimateCostCodes(access.db)
    const activeCostCodes = new Set(costCodeCatalog.map((row) => row.code))
    const missingCostCodes = sourceCostCodes.filter(
      (code) => !activeCostCodes.has(code)
    )
    const missingCostCodeSet = new Set(missingCostCodes)

    const now = new Date().toISOString()
    const lineValues = parsed.lines.map((line) => {
      const mappingNote = missingCostCodeSet.has(line.costCode)
        ? `Source CSI cost code ${line.costCode} is not active in Sage; remap before signature or accounting handoff.`
        : null
      return {
        id: crypto.randomUUID(),
        projectId,
        estimateId,
        divisionCode: line.divisionCode,
        divisionName: line.divisionName,
        costCode: line.costCode,
        costCodeName: line.description,
        description: line.description,
        specifications: [line.specifications, mappingNote]
          .filter(Boolean)
          .join(" ") || null,
        quantity: 1,
        unit: "LS",
        unitCostCents: line.amountCents,
        directCostCents: line.amountCents,
        markupRateBasisPoints: 0,
        markupCents: 0,
        taxable: false,
        taxEntityId: null,
        taxCode: null,
        taxName: null,
        taxRateBasisPoints: 0,
        taxCents: 0,
        lineTotalCents: line.amountCents,
        ownerVisible: true,
        sortOrder: line.sortOrder,
        createdAt: now,
        updatedAt: now,
      }
    })
    const [firstLine, ...remainingLines] = lineValues
    if (!firstLine) {
      throw new Error("Project Totals did not produce any importable lines.")
    }

    await access.db.batch([
      access.db
        .delete(projectEstimateLines)
        .where(eq(projectEstimateLines.estimateId, estimateId)),
      access.db.insert(projectEstimateLines).values(firstLine),
      ...remainingLines.map((lineValue) =>
        access.db.insert(projectEstimateLines).values(lineValue)
      ),
      access.db
        .update(projectEstimates)
        .set({
          sourceSystem: "google_csi_project_totals",
          sourceWorkbookId: spreadsheetId,
          sourceRevision: `Project Totals imported ${now}`,
          directCostCents: parsed.displayedTotalCents,
          markupCents: 0,
          taxCents: 0,
          estimateTotalCents: parsed.displayedTotalCents,
          updatedAt: now,
        })
        .where(eq(projectEstimates.id, estimateId)),
    ])

    revalidateEstimate(projectId)
    return {
      success: true,
      id: estimateId,
      lineCount: parsed.lines.length,
      totalCents: parsed.displayedTotalCents,
      roundingAdjustmentCents: parsed.roundingAdjustmentCents,
      missingSageMappingCount: missingCostCodes.length,
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Unable to import source CSI.",
    }
  }
}

export async function importPlanSwiftEstimateLines(
  projectId: string,
  estimateId: string,
  input: ProjectEstimatePlanSwiftImportInput
): Promise<ProjectEstimatePlanSwiftImportResult> {
  try {
    const access = await estimateAccess(projectId, true)
    await requireEditableEstimate(access.db, projectId, estimateId)
    if (input.lines.length === 0) {
      throw new Error("Select at least one PlanSwift row to import.")
    }
    if (input.lines.length > 2_000) {
      throw new Error("PlanSwift imports are limited to 2,000 rows.")
    }

    const sourceFileName = requiredText(
      input.sourceFileName.slice(0, 200),
      "Source file name"
    )
    const sourceSheetName = requiredText(
      input.sourceSheetName.slice(0, 200),
      "Source sheet name"
    )
    const normalizedLines = input.lines.map((line) => {
      const rowNumber = Math.round(line.rowNumber)
      const amountCents = Math.round(line.amount * 100)
      if (!Number.isFinite(line.rowNumber) || rowNumber < 1) {
        throw new Error("Every imported row must have a valid source row number.")
      }
      if (!Number.isFinite(line.amount) || amountCents <= 0) {
        throw new Error(`PlanSwift row ${rowNumber} must have a positive amount.`)
      }
      if (amountCents > 10_000_000_000) {
        throw new Error(`PlanSwift row ${rowNumber} exceeds the import amount limit.`)
      }
      return {
        rowNumber,
        costCode: requiredText(
          line.costCode.slice(0, 100),
          `Cost code on row ${rowNumber}`
        ),
        description: requiredText(
          line.description.slice(0, 500),
          `Description on row ${rowNumber}`
        ),
        notes: cleanText(line.notes?.slice(0, 5_000) ?? null),
        amountCents,
      }
    })

    const contractAdjustments = new Map<
      string,
      (typeof CONTRACT_ADJUSTMENT_COST_CODES)[number]
    >()
    for (const item of CONTRACT_ADJUSTMENT_COST_CODES) {
      contractAdjustments.set(item.value, item)
    }
    const sourceCostCodes = [...new Set(normalizedLines.map((line) => line.costCode))]
    const costRows = await loadProjectEstimateCostCodes(access.db)
    const costCodeMap = new Map(
      costRows.map((row) => [row.code, row])
    )
    const unknownCostCodes = sourceCostCodes.filter(
      (costCode) =>
        !costCodeMap.has(costCode) && !contractAdjustments.has(costCode)
    )
    if (unknownCostCodes.length > 0) {
      const examples = unknownCostCodes.slice(0, 5).join(", ")
      throw new Error(
        `Map every row to an active Sage cost code before importing. Not found: ${examples}.`
      )
    }

    const existingRows = await access.db
      .select()
      .from(projectEstimateLines)
      .where(eq(projectEstimateLines.estimateId, estimateId))
    const priorSortOrder = existingRows.reduce(
      (highest, row) => Math.max(highest, row.sortOrder),
      0
    )
    const now = new Date().toISOString()
    const lineValues = normalizedLines.map((line, index) => {
      const cost = costCodeMap.get(line.costCode)
      const adjustment = contractAdjustments.get(line.costCode)
      const sourceNote = `PlanSwift source: ${sourceFileName} · ${sourceSheetName} · row ${line.rowNumber}`
      return {
        id: crypto.randomUUID(),
        projectId,
        estimateId,
        templateLineId: null,
        divisionCode: cost?.divisionCode ?? "99",
        divisionName: cost?.divisionDescription ?? "Contract Adjustments",
        costCode: cost?.code ?? adjustment?.value ?? line.costCode,
        costCodeName:
          cost?.description ?? adjustment?.description ?? line.costCode,
        description: line.description,
        specifications: [line.notes, sourceNote].filter(Boolean).join("\n"),
        quantity: 1,
        unit: "LS",
        unitCostCents: line.amountCents,
        directCostCents: line.amountCents,
        markupRateBasisPoints: 0,
        markupCents: 0,
        taxable: false,
        taxEntityId: null,
        taxCode: null,
        taxName: null,
        taxRateBasisPoints: 0,
        taxCents: 0,
        lineTotalCents: line.amountCents,
        ownerVisible: false,
        sortOrder: priorSortOrder + index + 1,
        createdAt: now,
        updatedAt: now,
      }
    })
    const totals = calculateEstimateTotals([
      ...existingRows.map(ledgerLine),
      ...lineValues.map(ledgerLine),
    ])
    // D1 permits at most 100 bound parameters per statement. Each estimate
    // line binds 27 columns, so three rows keep every insert below the limit.
    const firstChunk = lineValues.slice(0, 3)
    const remainingChunks: Array<typeof lineValues> = []
    for (let index = 3; index < lineValues.length; index += 3) {
      remainingChunks.push(lineValues.slice(index, index + 3))
    }
    await access.db.batch([
      access.db.insert(projectEstimateLines).values(firstChunk),
      ...remainingChunks.map((chunk) =>
        access.db.insert(projectEstimateLines).values(chunk)
      ),
      access.db
        .update(projectEstimates)
        .set({ ...totals, updatedAt: now })
        .where(eq(projectEstimates.id, estimateId)),
    ])

    revalidateEstimate(projectId)
    return {
      success: true,
      id: estimateId,
      lineCount: lineValues.length,
      totalCents: lineValues.reduce(
        (total, line) => total + line.lineTotalCents,
        0
      ),
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to import the PlanSwift workbook.",
    }
  }
}

export async function saveProjectEstimateLine(
  projectId: string,
  estimateId: string,
  lineId: string | null,
  input: ProjectEstimateLineInput
): Promise<ProjectEstimateActionResult> {
  try {
    const access = await estimateAccess(projectId, true)
    const estimate = await requireEditableEstimate(
      access.db,
      projectId,
      estimateId
    )
    const costCode = requiredText(input.costCode, "Cost code")
    const contractAdjustment = CONTRACT_ADJUSTMENT_COST_CODES.find(
      (item) => item.value === costCode
    )
    const costRows = contractAdjustment
      ? []
      : await loadProjectEstimateCostCodes(access.db)
    const cost = costRows.find((row) => row.code === costCode)
    if (!cost && !contractAdjustment) {
      throw new Error("Choose an active Sage cost code.")
    }
    const taxEntityId = cleanText(input.taxEntityId) ?? estimate.defaultTaxEntityId
    const taxRows = taxEntityId
      ? await access.db
          .select()
          .from(sageTaxEntities)
          .where(and(eq(sageTaxEntities.id, taxEntityId), eq(sageTaxEntities.active, true)))
          .limit(1)
      : []
    const tax = taxRows[0]
    if (input.taxable && !tax) {
      throw new Error("Choose the Sage tax entity for a taxable line.")
    }
    const quantity = input.quantity ?? 1
    const unitCostCents = Math.round((input.unitCost ?? 0) * 100)
    const markupRateBasisPoints = Math.round((input.markupPercent ?? 0) * 100)
    const calculation = calculateEstimateLine({
      quantity,
      unitCostCents,
      markupRateBasisPoints,
      taxable: input.taxable,
      taxRateBasisPoints: tax?.rateBasisPoints ?? 0,
    })
    if (calculation.lineTotalCents <= 0) {
      throw new Error("Enter a quantity and unit cost greater than zero.")
    }
    const now = new Date().toISOString()
    const id = lineId ?? crypto.randomUUID()
    const prior = await access.db
      .select({ sortOrder: projectEstimateLines.sortOrder })
      .from(projectEstimateLines)
      .where(eq(projectEstimateLines.estimateId, estimateId))
      .orderBy(desc(projectEstimateLines.sortOrder))
      .limit(1)
    const values = {
      divisionCode: cost?.divisionCode ?? "99",
      divisionName: cost?.divisionDescription ?? "Contract Adjustments",
      costCode: cost?.code ?? contractAdjustment?.value ?? costCode,
      costCodeName:
        cost?.description ?? contractAdjustment?.description ?? costCode,
      description: requiredText(input.description, "Description"),
      specifications: cleanText(input.specifications),
      quantity,
      unit: cleanText(input.unit) ?? "LS",
      unitCostCents,
      ...calculation,
      markupRateBasisPoints,
      taxable: input.taxable,
      taxEntityId: tax?.id ?? null,
      taxCode: tax?.code ?? null,
      taxName: tax?.name ?? null,
      taxRateBasisPoints: tax?.rateBasisPoints ?? 0,
      ownerVisible: input.ownerVisible,
      updatedAt: now,
    }
    if (lineId) {
      const existing = await access.db
        .select({ id: projectEstimateLines.id })
        .from(projectEstimateLines)
        .where(
          and(
            eq(projectEstimateLines.id, lineId),
            eq(projectEstimateLines.estimateId, estimateId)
          )
        )
        .limit(1)
      if (!existing[0]) throw new Error("Estimate line not found.")
      await access.db
        .update(projectEstimateLines)
        .set(values)
        .where(eq(projectEstimateLines.id, lineId))
        .run()
    } else {
      await access.db.insert(projectEstimateLines).values({
        id,
        projectId,
        estimateId,
        ...values,
        sortOrder: (prior[0]?.sortOrder ?? 0) + 1,
        createdAt: now,
      })
    }
    await refreshEstimateTotals(access.db, estimateId, now)
    revalidateEstimate(projectId)
    return { success: true, id }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Unable to save estimate line.",
    }
  }
}

export async function deleteProjectEstimateLine(
  projectId: string,
  estimateId: string,
  lineId: string
): Promise<ProjectEstimateActionResult> {
  try {
    const access = await estimateAccess(projectId, true)
    await requireEditableEstimate(access.db, projectId, estimateId)
    await access.db
      .delete(projectEstimateLines)
      .where(
        and(
          eq(projectEstimateLines.id, lineId),
          eq(projectEstimateLines.estimateId, estimateId)
        )
      )
      .run()
    await refreshEstimateTotals(access.db, estimateId, new Date().toISOString())
    revalidateEstimate(projectId)
    return { success: true, id: lineId }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Unable to delete estimate line.",
    }
  }
}

export async function addProjectEstimateBasisDocument(
  projectId: string,
  estimateId: string,
  input: ProjectEstimateBasisInput
): Promise<ProjectEstimateActionResult> {
  try {
    const access = await estimateAccess(projectId, true)
    await requireEditableEstimate(access.db, projectId, estimateId)
    const prior = await access.db
      .select({ sortOrder: projectEstimateBasisDocuments.sortOrder })
      .from(projectEstimateBasisDocuments)
      .where(eq(projectEstimateBasisDocuments.estimateId, estimateId))
      .orderBy(desc(projectEstimateBasisDocuments.sortOrder))
      .limit(1)
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    await access.db.insert(projectEstimateBasisDocuments).values({
      id,
      projectId,
      estimateId,
      documentType: requiredText(input.documentType, "Document type"),
      title: requiredText(input.title, "Document title"),
      documentDate: cleanText(input.documentDate),
      revision: cleanText(input.revision),
      driveUrl: safeUrl(input.driveUrl),
      notes: cleanText(input.notes),
      sortOrder: (prior[0]?.sortOrder ?? 0) + 1,
      createdAt: now,
      updatedAt: now,
    })
    revalidateEstimate(projectId)
    return { success: true, id }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Unable to add basis document.",
    }
  }
}

export async function prepareProjectEstimateForFoxit(
  projectId: string,
  estimateId: string
): Promise<ProjectEstimateActionResult> {
  try {
    const access = await estimateAccess(projectId, true)
    const estimate = await requireEditableEstimate(
      access.db,
      projectId,
      estimateId
    )
    const [lines, basisDocuments, phaseDescriptions, acknowledgements] =
      await Promise.all([
        access.db
          .select()
          .from(projectEstimateLines)
          .where(eq(projectEstimateLines.estimateId, estimateId))
          .orderBy(asc(projectEstimateLines.sortOrder)),
        access.db
          .select()
          .from(projectEstimateBasisDocuments)
          .where(eq(projectEstimateBasisDocuments.estimateId, estimateId))
          .orderBy(asc(projectEstimateBasisDocuments.sortOrder)),
        access.db
          .select()
          .from(projectEstimatePhaseDescriptions)
          .where(eq(projectEstimatePhaseDescriptions.estimateId, estimateId))
          .orderBy(asc(projectEstimatePhaseDescriptions.divisionCode)),
        access.db
          .select()
          .from(projectEstimateAcknowledgements)
          .where(eq(projectEstimateAcknowledgements.estimateId, estimateId))
          .orderBy(asc(projectEstimateAcknowledgements.sortOrder)),
      ])
    if (lines.length === 0) throw new Error("Add estimate lines before signature.")
    const sourceCostCodes = [
      ...new Set(
        lines
          .filter((line) => line.divisionCode !== "99")
          .map((line) => line.costCode)
      ),
    ]
    const costCodeCatalog = await loadProjectEstimateCostCodes(access.db)
    const activeCostCodes = new Set(costCodeCatalog.map((row) => row.code))
    const missingCostCodes = sourceCostCodes.filter(
      (code) => !activeCostCodes.has(code)
    )
    if (missingCostCodes.length > 0) {
      throw new Error(
        `${missingCostCodes.length} estimate cost codes require Sage mapping before Foxit handoff: ${missingCostCodes.join(", ")}.`
      )
    }
    if (!cleanText(estimate.contractTerms)) {
      throw new Error("Add the contract terms before signature.")
    }
    const reportTitle = estimateTitleForDepartment({
      department: access.department,
      requestedTitle: estimate.title,
    })
    const sourceHash = await estimateSourceHash({
      estimateId,
      versionNumber: estimate.versionNumber,
      title: reportTitle,
      reportMode: estimateClientReportMode(access.department),
      introductionText: estimate.introductionText,
      contractTerms: estimate.contractTerms,
      closingText: estimate.closingText,
      lines: lines.map((line) => ({
        id: line.id,
        divisionCode: line.divisionCode,
        costCode: line.costCode,
        description: line.description,
        specifications: line.specifications,
        quantity: line.quantity,
        unit: line.unit,
        unitCostCents: line.unitCostCents,
        markupRateBasisPoints: line.markupRateBasisPoints,
        taxable: line.taxable,
        taxCode: line.taxCode,
        taxRateBasisPoints: line.taxRateBasisPoints,
        lineTotalCents: line.lineTotalCents,
        ownerVisible: line.ownerVisible,
        sortOrder: line.sortOrder,
      })),
      basisDocuments: basisDocuments.map((document) => ({
        id: document.id,
        documentType: document.documentType,
        title: document.title,
        documentDate: document.documentDate,
        revision: document.revision,
        driveFileId: document.driveFileId,
        driveUrl: document.driveUrl,
        notes: document.notes,
        sortOrder: document.sortOrder,
      })),
      phaseDescriptions: phaseDescriptions.map((phase) => ({
        divisionCode: phase.divisionCode,
        description: phase.description,
      })),
      acknowledgements: acknowledgements.map((acknowledgement) => ({
        templateId: acknowledgement.templateId,
        title: acknowledgement.title,
        body: acknowledgement.body,
        sortOrder: acknowledgement.sortOrder,
      })),
    })
    const now = new Date().toISOString()
    await access.db
      .update(projectEstimates)
      .set({
        title: reportTitle,
        status: "signature_pending",
        foxitStatus: "handoff_ready",
        signatureRequestedAt: now,
        sourceHash,
        updatedAt: now,
      })
      .where(eq(projectEstimates.id, estimateId))
      .run()
    revalidateEstimate(projectId)
    return { success: true, id: estimateId }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Unable to prepare signature.",
    }
  }
}

export async function recordSignedProjectEstimate(
  projectId: string,
  estimateId: string,
  input: {
    readonly signedDocumentUrl: string | null
    readonly foxitEnvelopeId: string | null
  }
): Promise<ProjectEstimateActionResult> {
  try {
    const access = await estimateAccess(projectId, true)
    const rows = await access.db
      .select()
      .from(projectEstimates)
      .where(
        and(
          eq(projectEstimates.id, estimateId),
          eq(projectEstimates.projectId, projectId)
        )
      )
      .limit(1)
    const estimate = rows[0]
    if (!estimate || estimate.status !== "signature_pending") {
      throw new Error("Only a signature-pending estimate can be accepted.")
    }
    const signaturePackageUrl = safeUrl(input.signedDocumentUrl)
    if (!signaturePackageUrl) {
      throw new Error("Add the signed Foxit document link before acceptance.")
    }
    const now = new Date().toISOString()
    // A project has one accepted contractual baseline. Preserve prior versions
    // for the audit trail while ensuring downstream budgets resolve unambiguously.
    await access.db
      .update(projectEstimates)
      .set({ status: "superseded", updatedAt: now })
      .where(
        and(
          eq(projectEstimates.projectId, projectId),
          eq(projectEstimates.status, "accepted"),
          ne(projectEstimates.id, estimateId)
        )
      )
      .run()
    await access.db
      .update(projectEstimates)
      .set({
        status: "accepted",
        foxitStatus: "completed",
        foxitEnvelopeId: cleanText(input.foxitEnvelopeId),
        signaturePackageUrl,
        signedAt: now,
        acceptedAt: now,
        acceptedBy: access.user.id,
        sageStatus: "ready",
        updatedAt: now,
      })
      .where(eq(projectEstimates.id, estimateId))
      .run()
    const budget = await rebuildProjectContractBudget({
      db: access.db,
      projectId,
      actorUserId: access.user.id,
    })
    if (!budget.success) {
      return {
        success: false,
        error: `Estimate accepted, but the contract budget needs review: ${budget.error}`,
      }
    }
    revalidateEstimate(projectId)
    return { success: true, id: estimateId }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Unable to accept estimate.",
    }
  }
}

export async function rebuildCurrentProjectContractBudget(
  projectId: string
): Promise<ProjectEstimateActionResult> {
  try {
    const access = await estimateAccess(projectId, true)
    const result = await rebuildProjectContractBudget({
      db: access.db,
      projectId,
      actorUserId: access.user.id,
    })
    if (!result.success) return result
    revalidateEstimate(projectId)
    return { success: true, id: result.revisionId }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Unable to rebuild budget.",
    }
  }
}
