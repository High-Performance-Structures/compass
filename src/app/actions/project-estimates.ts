"use server"

import { and, asc, desc, eq, gt, inArray, like, ne, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { saveEstimateTextTemplateLibraryItem } from "@/app/actions/estimate-text-templates"
import { getUploadSessionUrl } from "@/app/actions/google-drive"
import { getDb } from "@/db"
import {
  projectBudgetLines,
  projectContacts,
  projects,
  sageCostCodes,
} from "@/db/schema"
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
import { activityActorName, recordActivityEvent } from "@/lib/activity-log"
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
  isEstimateClientReportMode,
  isEstimateTextTemplateType,
  mergeEstimateTextTemplates,
  type EstimateClientReportMode,
  type EstimateTextTemplateOption,
  type EstimateTextTemplateType,
} from "@/lib/estimates/client-report"
import {
  projectEstimateCostCodeCatalog,
  type ProjectEstimateCostCodeCatalogItem,
} from "@/lib/estimates/project-cost-code-catalog"
import {
  compareEstimateVersions,
  type EstimateVersionComparison,
} from "@/lib/estimates/version-comparison"
import {
  estimateAcceptanceDate,
  estimateAcceptanceMethodLabel,
  isEstimateAcceptanceEvidenceMimeType,
  isEstimateAcceptanceMethod,
  type EstimateAcceptanceMethod,
} from "@/lib/estimates/manual-acceptance"
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
  readonly clientSignerContactId: string | null
  readonly clientSignerName: string | null
  readonly clientSignerTitle: string | null
  readonly clientSignerEmail: string | null
  readonly companySignerContactId: string | null
  readonly companySignerName: string | null
  readonly companySignerTitle: string | null
  readonly companySignerEmail: string | null
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
  readonly clientReportMode: EstimateClientReportMode
  readonly directCostCents: number
  readonly markupCents: number
  readonly taxCents: number
  readonly builderFeeBaseCents: number
  readonly overheadRateBasisPoints: number
  readonly overheadCents: number
  readonly marginRateBasisPoints: number
  readonly marginCents: number
  readonly contingencyRateBasisPoints: number
  readonly contingencyCents: number
  readonly builderFeeCents: number
  readonly estimateTotalCents: number
  readonly foxitStatus: string
  readonly foxitEnvelopeId: string | null
  readonly signaturePackageUrl: string | null
  readonly signedAt: string | null
  readonly acceptanceMethod: string | null
  readonly acceptanceNote: string | null
  readonly acceptanceEvidenceLabel: string | null
  readonly acceptanceRecordedByName: string | null
  readonly acceptedAt: string | null
  readonly sageStatus: string
  readonly createdAt: string
  readonly updatedAt: string
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
  readonly includeInBuilderFee: boolean
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
  readonly sageMapped: boolean
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

export type ProjectEstimateSignerOption = {
  readonly id: string
  readonly name: string
  readonly title: string | null
  readonly companyName: string | null
  readonly email: string | null
  readonly contactType: string
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
  readonly signerContacts: readonly ProjectEstimateSignerOption[]
}

export type ProjectEstimateManualAcceptanceInput = {
  readonly acceptanceMethod: string | null
  readonly clientAcceptedAt: string | null
  readonly evidenceUrl: string | null
  readonly evidenceLabel: string | null
  readonly acceptanceNote: string | null
  readonly attested: boolean
}

export type ProjectEstimateUploadSessionResult =
  | { readonly success: true; readonly uploadUrl: string }
  | { readonly success: false; readonly error: string }

export type ProjectEstimateVersionComparison = {
  readonly canEdit: boolean
  readonly projectNumber: string | null
  readonly projectName: string
  readonly estimates: readonly ProjectEstimateSummary[]
  readonly baseEstimate: ProjectEstimateSummary | null
  readonly revisedEstimate: ProjectEstimateSummary | null
  readonly comparison: EstimateVersionComparison | null
}

export type ProjectEstimateHeaderInput = {
  readonly estimateNumber: string | null
  readonly title: string | null
  readonly estimateDate: string | null
  readonly clientName: string | null
  readonly clientSignerContactId: string | null
  readonly clientSignerName: string | null
  readonly clientSignerTitle: string | null
  readonly clientSignerEmail: string | null
  readonly companySignerContactId: string | null
  readonly companySignerName: string | null
  readonly companySignerTitle: string | null
  readonly companySignerEmail: string | null
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
  readonly includeInBuilderFee: boolean
  readonly insertAfterLineId: string | null
}

export type ProjectEstimateBuilderFeeInput = {
  readonly overheadPercent: number | null
  readonly marginPercent: number | null
  readonly contingencyPercent: number | null
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
  readonly quantity: number | null
  readonly unit: string | null
  readonly unitCost: number | null
  readonly markupPercentage: number
  readonly amount: number
}

export type ProjectEstimatePlanSwiftImportInput = {
  readonly sourceFileName: string
  readonly sourceSheetName: string
  readonly replaceExistingPlanSwiftLines: boolean
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
  readonly rawDb: D1Database
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
    rawDb: env.DB,
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

async function validatedSignerContactId(
  db: CompassDb,
  projectId: string,
  contactId: string | null,
  label: string
): Promise<string | null> {
  const cleaned = cleanText(contactId)
  if (!cleaned) return null
  const rows = await db
    .select({ id: projectContacts.id })
    .from(projectContacts)
    .where(
      and(
        eq(projectContacts.id, cleaned),
        eq(projectContacts.projectId, projectId),
        eq(projectContacts.active, true)
      )
    )
    .limit(1)
  if (!rows[0]) throw new Error(`Choose an active project contact for ${label}.`)
  return cleaned
}

function requiredText(value: string | null, label: string): string {
  const cleaned = cleanText(value)
  if (!cleaned) throw new Error(`${label} is required.`)
  return cleaned
}

function rateBasisPoints(value: number | null, label: string): number {
  const basisPoints = Math.round((value ?? 0) * 100)
  if (
    !Number.isFinite(value ?? 0) ||
    basisPoints < 0 ||
    basisPoints > 1_000_000
  ) {
    throw new Error(`${label} must be between 0% and 10,000%.`)
  }
  return basisPoints
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

function safeEvidenceUrl(value: string | null): string | null {
  const url = safeUrl(value)
  if (!url) return null
  return new URL(url).protocol === "https:" ? url : null
}

function limitedText(
  value: string | null,
  label: string,
  maxLength: number,
  required = false
): string | null {
  const cleaned = cleanText(value)
  if (!cleaned) {
    if (required) throw new Error(`${label} is required.`)
    return null
  }
  if (cleaned.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer.`)
  }
  return cleaned
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
    clientSignerContactId: row.clientSignerContactId,
    clientSignerName: row.clientSignerName,
    clientSignerTitle: row.clientSignerTitle,
    clientSignerEmail: row.clientSignerEmail,
    companySignerContactId: row.companySignerContactId,
    companySignerName: row.companySignerName,
    companySignerTitle: row.companySignerTitle,
    companySignerEmail: row.companySignerEmail,
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
    clientReportMode: isEstimateClientReportMode(row.clientReportMode)
      ? row.clientReportMode
      : estimateClientReportMode(department),
    directCostCents: row.directCostCents,
    markupCents: row.markupCents,
    taxCents: row.taxCents,
    builderFeeBaseCents: row.builderFeeBaseCents,
    overheadRateBasisPoints: row.overheadRateBasisPoints,
    overheadCents: row.overheadCents,
    marginRateBasisPoints: row.marginRateBasisPoints,
    marginCents: row.marginCents,
    contingencyRateBasisPoints: row.contingencyRateBasisPoints,
    contingencyCents: row.contingencyCents,
    builderFeeCents: row.builderFeeCents,
    estimateTotalCents: row.estimateTotalCents,
    foxitStatus: row.foxitStatus,
    foxitEnvelopeId: row.foxitEnvelopeId,
    signaturePackageUrl: row.signaturePackageUrl,
    signedAt: row.signedAt,
    acceptanceMethod: row.acceptanceMethod,
    acceptanceNote: row.acceptanceNote,
    acceptanceEvidenceLabel: row.acceptanceEvidenceLabel,
    acceptanceRecordedByName: row.acceptanceRecordedByName,
    acceptedAt: row.acceptedAt,
    sageStatus: row.sageStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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
    includeInBuilderFee: row.includeInBuilderFee,
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
    includeInBuilderFee: row.includeInBuilderFee,
    sortOrder: row.sortOrder,
  }
}

function builderFeeComparisonLines(
  estimate: ProjectEstimateSummary
): readonly {
  readonly divisionCode: string
  readonly divisionName: string
  readonly costCode: string
  readonly description: string
  readonly lineTotalCents: number
}[] {
  const amounts = [
    estimate.overheadCents,
    estimate.marginCents,
    estimate.contingencyCents,
  ]
  return CONTRACT_ADJUSTMENT_COST_CODES.flatMap((item, index) => {
    const amount = amounts[index] ?? 0
    return amount === 0
      ? []
      : [{
          divisionCode: "00",
          divisionName: "Procurement Requirements",
          costCode: item.description,
          description: item.description,
          lineTotalCents: amount,
        }]
  })
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
  revalidatePath(`/dashboard/projects/${projectId}/estimate/compare`)
  revalidatePath(`/print/projects/${projectId}/estimate`)
  revalidatePath(`/print/projects/${projectId}/estimate/compare`)
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
  const [rows, estimateRows] = await Promise.all([
    db
      .select()
      .from(projectEstimateLines)
      .where(eq(projectEstimateLines.estimateId, estimateId)),
    db
      .select({
        overheadRateBasisPoints: projectEstimates.overheadRateBasisPoints,
        marginRateBasisPoints: projectEstimates.marginRateBasisPoints,
        contingencyRateBasisPoints:
          projectEstimates.contingencyRateBasisPoints,
      })
      .from(projectEstimates)
      .where(eq(projectEstimates.id, estimateId))
      .limit(1),
  ])
  const rates = estimateRows[0]
  if (!rates) throw new Error("Estimate not found.")
  const totals = calculateEstimateTotals(rows.map(ledgerLine), rates)
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
        eq(projectBudgetLines.sourceSystem, "sage_read_snapshot")
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
    signerContactRows,
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
    projectNumber: access.projectNumber,
    projectName: access.projectName,
    department: access.department,
    reportMode:
      selected?.clientReportMode ?? estimateClientReportMode(access.department),
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
    const contactRows = await access.db
      .select()
      .from(projectContacts)
      .where(
        and(
          eq(projectContacts.projectId, projectId),
          eq(projectContacts.active, true)
        )
      )
      .orderBy(
        desc(projectContacts.primaryContact),
        asc(projectContacts.sortOrder)
      )
    const clientSigner = contactRows.find(
      (contact) => contact.contactType === "owner"
    )
    const companySigner = contactRows.find(
      (contact) => contact.contactType === "internal"
    )
    await access.db.insert(projectEstimates).values({
      id,
      projectId,
      estimateNumber,
      versionNumber,
      title: defaultEstimateTitle(access.department),
      status: "draft",
      estimateDate: now.slice(0, 10),
      clientSignerContactId: clientSigner?.id ?? null,
      clientSignerName: clientSigner?.displayName ?? null,
      clientSignerTitle: clientSigner?.role ?? null,
      clientSignerEmail: clientSigner?.email ?? null,
      companySignerContactId: companySigner?.id ?? null,
      companySignerName: companySigner?.displayName ?? null,
      companySignerTitle: companySigner?.role ?? null,
      companySignerEmail: companySigner?.email ?? null,
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

export async function duplicateProjectEstimate(
  projectId: string,
  sourceEstimateId: string
): Promise<ProjectEstimateActionResult> {
  try {
    const access = await estimateAccess(projectId, true)
    const sourceRows = await access.db
      .select()
      .from(projectEstimates)
      .where(
        and(
          eq(projectEstimates.id, sourceEstimateId),
          eq(projectEstimates.projectId, projectId)
        )
      )
      .limit(1)
    const source = sourceRows[0]
    if (!source || !isEstimateStatus(source.status)) {
      throw new Error("Estimate version not found.")
    }

    const priorVersions = await access.db
      .select({ versionNumber: projectEstimates.versionNumber })
      .from(projectEstimates)
      .where(
        and(
          eq(projectEstimates.projectId, projectId),
          eq(projectEstimates.estimateNumber, source.estimateNumber)
        )
      )
      .orderBy(desc(projectEstimates.versionNumber))
      .limit(1)
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const versionNumber = (priorVersions[0]?.versionNumber ?? 0) + 1
    const copyStatements: D1PreparedStatement[] = [
      access.rawDb
        .prepare(
          `UPDATE project_estimates
           SET status = 'superseded', updated_at = ?
           WHERE project_id = ? AND estimate_number = ?
             AND status IN ('draft', 'internal_review', 'signature_pending')`
        )
        .bind(now, projectId, source.estimateNumber),
      access.rawDb
        .prepare(
          `INSERT INTO project_estimates (
             id, project_id, estimate_number, version_number, title, status,
             estimate_date, client_name, client_signer_contact_id,
             client_signer_name, client_signer_title, client_signer_email,
             company_signer_contact_id, company_signer_name,
             company_signer_title, company_signer_email,
             source_system, source_workbook_id,
             source_workbook_url, source_revision, template_version_id,
             template_application_id, default_tax_entity_id, default_tax_code,
             default_tax_name, default_tax_rate_basis_points, terms_template_id,
             contract_terms, introduction_template_id, introduction_text,
             closing_template_id, closing_text, client_report_mode,
             direct_cost_cents, markup_cents, tax_cents,
             builder_fee_base_cents, overhead_rate_basis_points,
             overhead_cents, margin_rate_basis_points, margin_cents,
             contingency_rate_basis_points, contingency_cents,
             builder_fee_cents, estimate_total_cents,
             foxit_status, foxit_envelope_id, signature_package_url,
             signature_requested_at, signed_at, accepted_at, accepted_by,
             sage_status, sage_record_id, last_sage_sync_at, source_hash,
             created_by, created_at, updated_at
           )
           SELECT ?, project_id, estimate_number, ?, title, 'draft', ?,
             client_name, client_signer_contact_id, client_signer_name,
             client_signer_title, client_signer_email,
             company_signer_contact_id, company_signer_name,
             company_signer_title, company_signer_email,
             'compass_revision', source_workbook_id,
             source_workbook_url, ?, template_version_id,
             template_application_id, default_tax_entity_id, default_tax_code,
             default_tax_name, default_tax_rate_basis_points, terms_template_id,
             contract_terms, introduction_template_id, introduction_text,
             closing_template_id, closing_text, client_report_mode,
             direct_cost_cents, markup_cents, tax_cents,
             builder_fee_base_cents, overhead_rate_basis_points,
             overhead_cents, margin_rate_basis_points, margin_cents,
             contingency_rate_basis_points, contingency_cents,
             builder_fee_cents, estimate_total_cents,
             'not_started', NULL, NULL, NULL, NULL, NULL, NULL,
             'not_ready', NULL, NULL, NULL, ?, ?, ?
           FROM project_estimates
           WHERE id = ? AND project_id = ?`
        )
        .bind(
          id,
          versionNumber,
          now.slice(0, 10),
          `Duplicated from version ${source.versionNumber} on ${now.slice(0, 10)}`,
          access.user.id,
          now,
          now,
          sourceEstimateId,
          projectId
        ),
      access.rawDb
        .prepare(
          `INSERT INTO project_estimate_lines (
             id, project_id, estimate_id, template_line_id, division_code,
             division_name, cost_code, cost_code_name, description,
             specifications, quantity, unit, unit_cost_cents, direct_cost_cents,
             markup_rate_basis_points, markup_cents, taxable, tax_entity_id,
             tax_code, tax_name, tax_rate_basis_points, tax_cents,
             line_total_cents, owner_visible, include_in_builder_fee,
             sort_order, created_at, updated_at
           )
           SELECT lower(hex(randomblob(16))), project_id, ?, template_line_id,
             division_code, division_name, cost_code, cost_code_name,
             description, specifications, quantity, unit, unit_cost_cents,
             direct_cost_cents, markup_rate_basis_points, markup_cents, taxable,
             tax_entity_id, tax_code, tax_name, tax_rate_basis_points, tax_cents,
             line_total_cents, owner_visible, include_in_builder_fee,
             sort_order, ?, ?
           FROM project_estimate_lines
           WHERE estimate_id = ? AND project_id = ?`
        )
        .bind(id, now, now, sourceEstimateId, projectId),
      access.rawDb
        .prepare(
          `INSERT INTO project_estimate_basis_documents (
             id, project_id, estimate_id, document_type, title, document_date,
             revision, drive_file_id, drive_url, notes, sort_order, created_at,
             updated_at
           )
           SELECT lower(hex(randomblob(16))), project_id, ?, document_type,
             title, document_date, revision, drive_file_id, drive_url, notes,
             sort_order, ?, ?
           FROM project_estimate_basis_documents
           WHERE estimate_id = ? AND project_id = ?`
        )
        .bind(id, now, now, sourceEstimateId, projectId),
      access.rawDb
        .prepare(
          `INSERT INTO project_estimate_phase_descriptions (
             id, project_id, estimate_id, division_code, description,
             created_at, updated_at
           )
           SELECT lower(hex(randomblob(16))), project_id, ?, division_code,
             description, ?, ?
           FROM project_estimate_phase_descriptions
           WHERE estimate_id = ? AND project_id = ?`
        )
        .bind(id, now, now, sourceEstimateId, projectId),
      access.rawDb
        .prepare(
          `INSERT INTO project_estimate_acknowledgements (
             id, project_id, estimate_id, template_id, title, body,
             source_document_id, source_url, sort_order, created_at, updated_at
           )
           SELECT lower(hex(randomblob(16))), project_id, ?, template_id, title,
             body, source_document_id, source_url, sort_order, ?, ?
           FROM project_estimate_acknowledgements
           WHERE estimate_id = ? AND project_id = ?`
        )
        .bind(id, now, now, sourceEstimateId, projectId),
    ]
    const copyResults = await access.rawDb.batch(copyStatements)
    if (copyResults.some((result) => !result.success)) {
      throw new Error("The estimate version copy did not complete.")
    }

    revalidateEstimate(projectId)
    return { success: true, id }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to create the next estimate version.",
    }
  }
}

export async function getProjectEstimateVersionComparison(
  projectId: string,
  baseEstimateId?: string,
  revisedEstimateId?: string
): Promise<ProjectEstimateVersionComparison> {
  const access = await estimateAccess(projectId, false)
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
    canEdit: isInternalStaffRole(access.user.role),
    projectNumber: access.projectNumber,
    projectName: access.projectName,
    estimates,
    baseEstimate,
    revisedEstimate,
    comparison,
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
    const [clientSignerContactId, companySignerContactId] = await Promise.all([
      validatedSignerContactId(
        access.db,
        projectId,
        input.clientSignerContactId,
        "the client signer"
      ),
      validatedSignerContactId(
        access.db,
        projectId,
        input.companySignerContactId,
        "the company representative"
      ),
    ])
    await access.db
      .update(projectEstimates)
      .set({
        estimateNumber: requiredText(input.estimateNumber, "Estimate number"),
        title: requiredText(input.title, "Estimate title"),
        estimateDate: requiredText(input.estimateDate, "Estimate date"),
        clientName: cleanText(input.clientName),
        clientSignerContactId,
        clientSignerName: limitedText(
          input.clientSignerName,
          "Client signer name",
          200
        ),
        clientSignerTitle: limitedText(
          input.clientSignerTitle,
          "Client signer title",
          200
        ),
        clientSignerEmail: limitedText(
          input.clientSignerEmail,
          "Client signer email",
          320
        ),
        companySignerContactId,
        companySignerName: limitedText(
          input.companySignerName,
          "Company representative name",
          200
        ),
        companySignerTitle: limitedText(
          input.companySignerTitle,
          "Company representative title",
          200
        ),
        companySignerEmail: limitedText(
          input.companySignerEmail,
          "Company representative email",
          320
        ),
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

export async function setProjectEstimateClientReportMode(
  projectId: string,
  estimateId: string,
  mode: string
): Promise<ProjectEstimateActionResult> {
  try {
    const access = await estimateAccess(projectId, true)
    await requireEditableEstimate(access.db, projectId, estimateId)
    if (!isEstimateClientReportMode(mode)) {
      throw new Error("Choose an available client report view.")
    }
    await access.db
      .update(projectEstimates)
      .set({ clientReportMode: mode, updatedAt: new Date().toISOString() })
      .where(eq(projectEstimates.id, estimateId))
      .run()
    revalidateEstimate(projectId)
    return { success: true, id: estimateId }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to save the client report view.",
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
  }
): Promise<ProjectEstimateActionResult> {
  try {
    const access = await estimateAccess(projectId, true)
    const result = await saveEstimateTextTemplateLibraryItem({
      templateId: null,
      name: input.name,
      departmentCode: access.department,
      templateType: input.templateType,
      body: input.body,
    })
    if (!result.success) return result
    revalidateEstimate(projectId)
    return { success: true, id: result.id }
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

    const sourceCostCodes = parsed.lines.map((line) => line.costCode)
    const costCodeCatalog = await loadProjectEstimateCostCodes(access.db)
    const activeCostCodes = new Set(
      costCodeCatalog.filter((row) => row.sageMapped).map((row) => row.code)
    )
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
        includeInBuilderFee: true,
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
          directCostCents: parsed.projectSubtotalCents,
          markupCents: 0,
          taxCents: 0,
          builderFeeBaseCents: parsed.projectSubtotalCents,
          overheadRateBasisPoints: parsed.overheadRateBasisPoints,
          overheadCents: parsed.overheadCents,
          marginRateBasisPoints: parsed.marginRateBasisPoints,
          marginCents: parsed.marginCents,
          contingencyRateBasisPoints: parsed.contingencyRateBasisPoints,
          contingencyCents: parsed.contingencyCents,
          builderFeeCents:
            parsed.overheadCents +
            parsed.marginCents +
            parsed.contingencyCents,
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
    const estimate = await requireEditableEstimate(
      access.db,
      projectId,
      estimateId
    )
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
      const quantity = line.quantity ?? 1
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error(`PlanSwift row ${rowNumber} must have a positive quantity.`)
      }
      const markupRateBasisPoints = Math.round(line.markupPercentage * 100)
      if (
        !Number.isFinite(line.markupPercentage) ||
        markupRateBasisPoints < 0 ||
        markupRateBasisPoints > 1_000_000
      ) {
        throw new Error(`PlanSwift row ${rowNumber} has an invalid markup.`)
      }
      const unitCostCents =
        line.unitCost !== null && line.unitCost > 0
          ? Math.round(line.unitCost * 100)
          : Math.round(amountCents / quantity / (1 + line.markupPercentage / 100))
      if (!Number.isFinite(unitCostCents) || unitCostCents <= 0) {
        throw new Error(`PlanSwift row ${rowNumber} must have a positive unit cost.`)
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
        quantity,
        unit: cleanText(line.unit?.slice(0, 40) ?? null) ?? "LS",
        unitCostCents,
        markupRateBasisPoints,
        amountCents,
      }
    })

    const sourceCostCodes = [...new Set(normalizedLines.map((line) => line.costCode))]
    const costRows = await loadProjectEstimateCostCodes(access.db)
    const costCodeMap = new Map(
      costRows.map((row) => [row.code, row])
    )
    const unknownCostCodes = sourceCostCodes.filter(
      (costCode) => !costCodeMap.has(costCode)
    )
    if (unknownCostCodes.length > 0) {
      const examples = unknownCostCodes.slice(0, 5).join(", ")
      throw new Error(
        `Map every row to a verified CSI/Sage catalog code before importing. Not found: ${examples}.`
      )
    }

    const existingRows = await access.db
      .select()
      .from(projectEstimateLines)
      .where(eq(projectEstimateLines.estimateId, estimateId))
    const retainedRows = input.replaceExistingPlanSwiftLines
      ? existingRows.filter(
          (row) => !row.specifications?.includes("PlanSwift source:")
        )
      : existingRows
    const priorSortOrder = retainedRows.reduce(
      (highest, row) => Math.max(highest, row.sortOrder),
      0
    )
    const now = new Date().toISOString()
    const lineValues = normalizedLines.map((line, index) => {
      const cost = costCodeMap.get(line.costCode)
      if (!cost) throw new Error(`Cost code ${line.costCode} is unavailable.`)
      const sourceNote = `PlanSwift source: ${sourceFileName} · ${sourceSheetName} · row ${line.rowNumber}`
      const calculation = calculateEstimateLine({
        quantity: line.quantity,
        unitCostCents: line.unitCostCents,
        markupRateBasisPoints: line.markupRateBasisPoints,
        taxable: false,
        taxRateBasisPoints: 0,
      })
      return {
        id: crypto.randomUUID(),
        projectId,
        estimateId,
        templateLineId: null,
        divisionCode: cost.divisionCode,
        divisionName: cost.divisionDescription,
        costCode: cost.code,
        costCodeName: cost.description,
        description: line.description,
        specifications: [line.notes, sourceNote].filter(Boolean).join("\n"),
        quantity: line.quantity,
        unit: line.unit,
        unitCostCents: line.unitCostCents,
        directCostCents: calculation.directCostCents,
        markupRateBasisPoints: line.markupRateBasisPoints,
        markupCents: calculation.markupCents,
        taxable: false,
        taxEntityId: null,
        taxCode: null,
        taxName: null,
        taxRateBasisPoints: 0,
        taxCents: calculation.taxCents,
        lineTotalCents: calculation.lineTotalCents,
        ownerVisible: true,
        includeInBuilderFee: true,
        sortOrder: priorSortOrder + index + 1,
        createdAt: now,
        updatedAt: now,
      }
    })
    const totals = calculateEstimateTotals(
      [...retainedRows.map(ledgerLine), ...lineValues.map(ledgerLine)],
      {
        overheadRateBasisPoints: estimate.overheadRateBasisPoints,
        marginRateBasisPoints: estimate.marginRateBasisPoints,
        contingencyRateBasisPoints: estimate.contingencyRateBasisPoints,
      }
    )
    // D1 permits at most 100 bound parameters per statement. Each estimate
    // line binds 27 columns, so three rows keep every insert below the limit.
    const firstChunk = lineValues.slice(0, 3)
    const remainingChunks: Array<typeof lineValues> = []
    for (let index = 3; index < lineValues.length; index += 3) {
      remainingChunks.push(lineValues.slice(index, index + 3))
    }
    const firstInsert = access.db
      .insert(projectEstimateLines)
      .values(firstChunk)
    const remainingInserts = remainingChunks.map((chunk) =>
      access.db.insert(projectEstimateLines).values(chunk)
    )
    const totalsUpdate = access.db
      .update(projectEstimates)
      .set({ ...totals, updatedAt: now })
      .where(eq(projectEstimates.id, estimateId))
    if (input.replaceExistingPlanSwiftLines) {
      const deletePriorImports = access.db
        .delete(projectEstimateLines)
        .where(
          and(
            eq(projectEstimateLines.estimateId, estimateId),
            like(projectEstimateLines.specifications, "%PlanSwift source:%")
          )
        )
      await access.db.batch([
        deletePriorImports,
        firstInsert,
        ...remainingInserts,
        totalsUpdate,
      ])
    } else {
      await access.db.batch([firstInsert, ...remainingInserts, totalsUpdate])
    }

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
    const costRows = await loadProjectEstimateCostCodes(access.db)
    const cost = costRows.find((row) => row.code === costCode)
    if (!cost) {
      throw new Error("Choose a verified CSI/Sage catalog cost code.")
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
    const prior = lineId
      ? []
      : await access.db
          .select({
            id: projectEstimateLines.id,
            sortOrder: projectEstimateLines.sortOrder,
          })
          .from(projectEstimateLines)
          .where(eq(projectEstimateLines.estimateId, estimateId))
          .orderBy(desc(projectEstimateLines.sortOrder))
    const values = {
      divisionCode: cost.divisionCode,
      divisionName: cost.divisionDescription,
      costCode: cost.code,
      costCodeName: cost.description,
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
      includeInBuilderFee: input.includeInBuilderFee,
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
      const insertionTarget = input.insertAfterLineId
        ? prior.find((item) => item.id === input.insertAfterLineId)
        : null
      if (input.insertAfterLineId && !insertionTarget) {
        throw new Error("The selected insertion point is no longer available.")
      }
      const sortOrder = insertionTarget
        ? insertionTarget.sortOrder + 1
        : (prior[0]?.sortOrder ?? 0) + 1
      if (insertionTarget) {
        await access.db
          .update(projectEstimateLines)
          .set({
            sortOrder: sql`${projectEstimateLines.sortOrder} + 1`,
            updatedAt: now,
          })
          .where(
            and(
              eq(projectEstimateLines.estimateId, estimateId),
              gt(projectEstimateLines.sortOrder, insertionTarget.sortOrder)
            )
          )
          .run()
      }
      await access.db.insert(projectEstimateLines).values({
        id,
        projectId,
        estimateId,
        ...values,
        sortOrder,
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

export async function applyProjectEstimateLineMarkup(
  projectId: string,
  estimateId: string,
  markupPercent: number | null
): Promise<ProjectEstimateActionResult> {
  try {
    const access = await estimateAccess(projectId, true)
    await requireEditableEstimate(access.db, projectId, estimateId)
    const markupRateBasisPoints = rateBasisPoints(markupPercent, "Line markup")
    const rows = await access.db
      .select()
      .from(projectEstimateLines)
      .where(eq(projectEstimateLines.estimateId, estimateId))
    if (rows.length === 0) throw new Error("Add an estimate line first.")

    const now = new Date().toISOString()
    const legacyAdjustmentCodes = new Set<string>(
      CONTRACT_ADJUSTMENT_COST_CODES.map((item) => item.value)
    )
    const statements = rows
      .filter((row) => !legacyAdjustmentCodes.has(row.costCode))
      .map((row) => {
        const calculation = calculateEstimateLine({
          quantity: row.quantity,
          unitCostCents: row.unitCostCents,
          markupRateBasisPoints,
          taxable: row.taxable,
          taxRateBasisPoints: row.taxRateBasisPoints,
        })
        return access.rawDb
          .prepare(
            `UPDATE project_estimate_lines
             SET markup_rate_basis_points = ?, direct_cost_cents = ?,
               markup_cents = ?, tax_cents = ?, line_total_cents = ?,
               updated_at = ?
             WHERE id = ? AND estimate_id = ? AND project_id = ?`
          )
          .bind(
            markupRateBasisPoints,
            calculation.directCostCents,
            calculation.markupCents,
            calculation.taxCents,
            calculation.lineTotalCents,
            now,
            row.id,
            estimateId,
            projectId
          )
      })
    if (statements.length === 0) {
      throw new Error("Add a CSI cost-code line before applying markup.")
    }
    for (let index = 0; index < statements.length; index += 50) {
      const results = await access.rawDb.batch(
        statements.slice(index, index + 50)
      )
      if (results.some((result) => !result.success)) {
        throw new Error("The line markup update did not complete.")
      }
    }
    await refreshEstimateTotals(access.db, estimateId, now)
    revalidateEstimate(projectId)
    return { success: true, id: estimateId }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Unable to apply line markup.",
    }
  }
}

export async function updateProjectEstimateBuilderFee(
  projectId: string,
  estimateId: string,
  input: ProjectEstimateBuilderFeeInput
): Promise<ProjectEstimateActionResult> {
  try {
    const access = await estimateAccess(projectId, true)
    await requireEditableEstimate(access.db, projectId, estimateId)
    const legacyRows = await access.db
      .select({ id: projectEstimateLines.id })
      .from(projectEstimateLines)
      .where(
        and(
          eq(projectEstimateLines.estimateId, estimateId),
          inArray(
            projectEstimateLines.costCode,
            CONTRACT_ADJUSTMENT_COST_CODES.map((item) => item.value)
          )
        )
      )
      .limit(1)
    if (legacyRows[0]) {
      throw new Error(
        "This draft still has legacy Division 99 fee lines. Re-import its source CSI, or remove those lines, before setting the builder fee."
      )
    }
    const now = new Date().toISOString()
    await access.db
      .update(projectEstimates)
      .set({
        overheadRateBasisPoints: rateBasisPoints(
          input.overheadPercent,
          "Overhead"
        ),
        marginRateBasisPoints: rateBasisPoints(input.marginPercent, "Margin"),
        contingencyRateBasisPoints: rateBasisPoints(
          input.contingencyPercent,
          "Contingency"
        ),
        updatedAt: now,
      })
      .where(eq(projectEstimates.id, estimateId))
      .run()
    await refreshEstimateTotals(access.db, estimateId, now)
    revalidateEstimate(projectId)
    return { success: true, id: estimateId }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to update the builder fee.",
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

export async function prepareProjectEstimateForClientSignature(
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
    if (!cleanText(estimate.estimateDate)) {
      throw new Error("Add the estimate date before signature.")
    }
    if (!cleanText(estimate.clientSignerName)) {
      throw new Error("Choose or type the client signer before signature.")
    }
    if (!cleanText(estimate.companySignerName)) {
      throw new Error(
        "Choose or type the company representative before signature."
      )
    }
    const sourceCostCodes = [
      ...new Set(
        lines
          .filter((line) => line.divisionCode !== "99")
          .map((line) => line.costCode)
      ),
    ]
    const costCodeCatalog = await loadProjectEstimateCostCodes(access.db)
    const activeCostCodes = new Set(
      costCodeCatalog.filter((row) => row.sageMapped).map((row) => row.code)
    )
    const missingCostCodes = sourceCostCodes.filter(
      (code) => !activeCostCodes.has(code)
    )
    if (missingCostCodes.length > 0) {
      throw new Error(
        `${missingCostCodes.length} estimate cost codes require Sage mapping before signature handoff: ${missingCostCodes.join(", ")}.`
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
      reportMode: isEstimateClientReportMode(estimate.clientReportMode)
        ? estimate.clientReportMode
        : estimateClientReportMode(access.department),
      introductionText: estimate.introductionText,
      contractTerms: estimate.contractTerms,
      closingText: estimate.closingText,
      signers: {
        clientName: estimate.clientSignerName,
        clientTitle: estimate.clientSignerTitle,
        clientEmail: estimate.clientSignerEmail,
        companyName: estimate.companySignerName,
        companyTitle: estimate.companySignerTitle,
        companyEmail: estimate.companySignerEmail,
      },
      overheadRateBasisPoints: estimate.overheadRateBasisPoints,
      marginRateBasisPoints: estimate.marginRateBasisPoints,
      contingencyRateBasisPoints: estimate.contingencyRateBasisPoints,
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
        includeInBuilderFee: line.includeInBuilderFee,
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
        foxitStatus: "not_started",
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

async function acceptProjectEstimate(input: {
  readonly access: EstimateAccess
  readonly estimate: typeof projectEstimates.$inferSelect
  readonly acceptanceMethod: EstimateAcceptanceMethod
  readonly evidenceUrl: string
  readonly evidenceLabel: string
  readonly acceptanceNote: string | null
  readonly signedAt: string
  readonly foxitStatus: string
  readonly foxitEnvelopeId: string | null
}): Promise<ProjectEstimateActionResult> {
  const now = new Date().toISOString()
  const recordedByName = activityActorName(input.access.user)

  // A project has one accepted contractual baseline. Preserve old versions for
  // audit while switching the baseline and its proof in one D1 batch.
  await input.access.db.batch([
    input.access.db
      .update(projectEstimates)
      .set({ status: "superseded", updatedAt: now })
      .where(
        and(
          eq(projectEstimates.projectId, input.estimate.projectId),
          eq(projectEstimates.status, "accepted"),
          ne(projectEstimates.id, input.estimate.id)
        )
      ),
    input.access.db
      .update(projectEstimates)
      .set({
        status: "accepted",
        foxitStatus: input.foxitStatus,
        foxitEnvelopeId: input.foxitEnvelopeId,
        signaturePackageUrl: input.evidenceUrl,
        signedAt: input.signedAt,
        acceptanceMethod: input.acceptanceMethod,
        acceptanceNote: input.acceptanceNote,
        acceptanceEvidenceLabel: input.evidenceLabel,
        acceptanceRecordedByName: recordedByName,
        acceptedAt: now,
        acceptedBy: input.access.user.id,
        sageStatus: "ready",
        updatedAt: now,
      })
      .where(eq(projectEstimates.id, input.estimate.id)),
  ])

  const budget = await rebuildProjectContractBudget({
    db: input.access.db,
    projectId: input.estimate.projectId,
    actorUserId: input.access.user.id,
  })
  if (!budget.success) {
    return {
      success: false,
      error: `Estimate accepted, but the contract budget needs review: ${budget.error}`,
    }
  }

  if (input.access.organizationId) {
    await recordActivityEvent({
      db: input.access.db,
      organizationId: input.access.organizationId,
      projectId: input.estimate.projectId,
      actor: input.access.user,
      category: "financial",
      action: "estimate_client_acceptance_recorded",
      entityType: "project_estimate",
      entityId: input.estimate.id,
      summary: `Recorded client acceptance for ${input.estimate.estimateNumber} via ${estimateAcceptanceMethodLabel(input.acceptanceMethod)}.`,
      metadata: {
        acceptanceMethod: input.acceptanceMethod,
        acceptanceDate: input.signedAt.slice(0, 10),
        estimateTotalCents: input.estimate.estimateTotalCents,
      },
      createdAt: now,
    })
  }

  revalidateEstimate(input.estimate.projectId)
  return { success: true, id: input.estimate.id }
}

async function signaturePendingEstimate(
  access: EstimateAccess,
  projectId: string,
  estimateId: string
): Promise<typeof projectEstimates.$inferSelect> {
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
    throw new Error(
      "Lock the final estimate version for client signature before recording acceptance."
    )
  }
  return estimate
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
    const estimate = await signaturePendingEstimate(access, projectId, estimateId)
    const signaturePackageUrl = safeEvidenceUrl(input.signedDocumentUrl)
    if (!signaturePackageUrl) {
      throw new Error("Add the completed Foxit document link before acceptance.")
    }
    return acceptProjectEstimate({
      access,
      estimate,
      acceptanceMethod: "foxit",
      evidenceUrl: signaturePackageUrl,
      evidenceLabel: "Completed Foxit estimate",
      acceptanceNote: null,
      signedAt: new Date().toISOString(),
      foxitStatus: "completed",
      foxitEnvelopeId: cleanText(input.foxitEnvelopeId),
    })
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Unable to accept estimate.",
    }
  }
}

export async function recordManualProjectEstimateAcceptance(
  projectId: string,
  estimateId: string,
  input: ProjectEstimateManualAcceptanceInput
): Promise<ProjectEstimateActionResult> {
  try {
    const access = await estimateAccess(projectId, true)
    const estimate = await signaturePendingEstimate(access, projectId, estimateId)
    if (!input.attested) {
      throw new Error(
        "Confirm that the document contains the required client and company representative signatures."
      )
    }
    if (
      !isEstimateAcceptanceMethod(input.acceptanceMethod) ||
      input.acceptanceMethod === "foxit"
    ) {
      throw new Error("Choose how the client signed the estimate.")
    }
    const evidenceUrl = safeEvidenceUrl(input.evidenceUrl)
    if (!evidenceUrl) {
      throw new Error("Upload or link the saved signed document.")
    }
    const evidenceLabel = limitedText(
      input.evidenceLabel,
      "Signed document label",
      200,
      true
    )
    const acceptanceNote = limitedText(
      input.acceptanceNote,
      "Acceptance note",
      2_000
    )
    if (!evidenceLabel) {
      throw new Error("Signed document label is required.")
    }

    return acceptProjectEstimate({
      access,
      estimate,
      acceptanceMethod: input.acceptanceMethod,
      evidenceUrl,
      evidenceLabel,
      acceptanceNote,
      signedAt: estimateAcceptanceDate(input.clientAcceptedAt),
      foxitStatus: "not_applicable",
      foxitEnvelopeId: null,
    })
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to record manual estimate acceptance.",
    }
  }
}

export async function getProjectEstimateAcceptanceUploadSessionUrl(
  projectId: string,
  fileName: string,
  mimeType: string
): Promise<ProjectEstimateUploadSessionResult> {
  try {
    const access = await estimateAccess(projectId, true)
    const safeFileName = limitedText(fileName, "File name", 240, true)
    const safeMimeType = limitedText(mimeType, "File type", 160, true)
    if (!safeFileName || !safeMimeType) {
      throw new Error("Choose a signed document to upload.")
    }
    if (!isEstimateAcceptanceEvidenceMimeType(safeMimeType)) {
      throw new Error(
        "Upload the signed document as a PDF, Word document, or image."
      )
    }
    const projectRows = await access.db
      .select({ googleDriveFolderId: projects.googleDriveFolderId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)
    const googleDriveFolderId = projectRows[0]?.googleDriveFolderId
    if (!googleDriveFolderId) {
      throw new Error(
        "Connect the project Google Drive folder before uploading the signed document."
      )
    }
    return getUploadSessionUrl(safeFileName, safeMimeType, googleDriveFolderId)
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to start the signed document upload.",
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
