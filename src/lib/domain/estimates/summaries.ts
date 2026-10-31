import type {
  projectEstimateLineCostItems,
  projectEstimateLines,
  projectEstimates,
} from "@/db/schema-estimates"
import { limitedText, signerInitials } from "@/lib/domain/estimates/rules"
import type {
  ProjectEstimateLineItem,
  ProjectEstimateSigner,
  ProjectEstimateSummary,
  ProjectEstimateTermsOption,
} from "@/lib/domain/estimates/types"
import {
  estimateClientReportMode,
  estimateTitleForDepartment,
  isEstimateClientReportMode,
  type EstimateTextTemplateOption,
} from "@/lib/estimates/client-report"
import { CONTRACT_ADJUSTMENT_COST_CODES } from "@/lib/financials/project-totals-import"
import type { ProjectDepartment } from "@/lib/project-branding"
import { cleanText } from "@/lib/shared/guards"

/** How saved estimate rows read in the workspace and on reports. Pure. */

export function normalizeEstimateSigner(
  value: ProjectEstimateSigner
): ProjectEstimateSigner | null {
  const name = limitedText(value.name, "Signer name", 200)
  if (!name) return null
  const email = limitedText(value.email, "Signer email", 320) ?? ""
  if (email && !/^\S+@\S+\.\S+$/.test(email)) {
    throw new Error(`Enter a valid email address for ${name}.`)
  }
  const initials =
    limitedText(value.initials, "Signer initials", 6) ?? signerInitials(name)
  return {
    contactId: cleanText(value.contactId),
    name,
    title: limitedText(value.title, "Signer title", 200) ?? "",
    email,
    initials: initials.toUpperCase(),
  }
}

export function projectEstimateClientSigners(
  row: typeof projectEstimates.$inferSelect
): readonly ProjectEstimateSigner[] {
  if (row.clientSignersJson) {
    try {
      const parsed: unknown = JSON.parse(row.clientSignersJson)
      if (Array.isArray(parsed)) {
        return parsed.flatMap((item): readonly ProjectEstimateSigner[] => {
          if (!item || typeof item !== "object") return []
          const name = Reflect.get(item, "name")
          if (typeof name !== "string" || !name.trim()) return []
          const stringValue = (key: string): string => {
            const value = Reflect.get(item, key)
            return typeof value === "string" ? value : ""
          }
          const contactId = Reflect.get(item, "contactId")
          return [{
            contactId: typeof contactId === "string" ? contactId : null,
            name: name.trim(),
            title: stringValue("title"),
            email: stringValue("email"),
            initials: stringValue("initials") || signerInitials(name),
          }]
        })
      }
    } catch {
      // Preserve access to pre-migration estimates if legacy data is malformed.
    }
  }
  const legacyName = cleanText(row.clientSignerName)
  if (!legacyName) return []
  return [{
    contactId: row.clientSignerContactId,
    name: legacyName,
    title: row.clientSignerTitle ?? "",
    email: row.clientSignerEmail ?? "",
    initials: signerInitials(legacyName),
  }]
}

export function templateDepartment(value: string | null): ProjectDepartment | null {
  if (value === "O" || value === "H" || value === "N" || value === "D") {
    return value
  }
  return null
}

export function templateOption(
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

export function estimateSummary(
  row: typeof projectEstimates.$inferSelect,
  department: ProjectDepartment,
  includeSignatureSession = false
): ProjectEstimateSummary {
  return {
    id: row.id,
    changeOrderId: row.changeOrderId,
    phaseProposalId: row.phaseProposalId,
    estimateNumber: row.estimateNumber,
    versionNumber: row.versionNumber,
    title: estimateTitleForDepartment({
      department,
      requestedTitle: row.title,
    }),
    status: row.status,
    estimateDate: row.estimateDate,
    clientName: row.clientName,
    clientMailingAddress: row.clientMailingAddress,
    clientSignerContactId: row.clientSignerContactId,
    clientSignerName: row.clientSignerName,
    clientSignerTitle: row.clientSignerTitle,
    clientSignerEmail: row.clientSignerEmail,
    clientSigners: projectEstimateClientSigners(row),
    companySignerContactId: row.companySignerContactId,
    companySignerName: row.companySignerName,
    companySignerTitle: row.companySignerTitle,
    companySignerEmail: row.companySignerEmail,
    companySignerInitials: row.companySignerInitials,
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
    showCostBreakdowns: row.showCostBreakdowns ?? false,
    showAssemblyBuilderFee: row.showAssemblyBuilderFee ?? false,
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
    foxitEmbeddedSessionUrl: includeSignatureSession
      ? row.foxitEmbeddedSessionUrl
      : null,
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

export function estimateLineItem(
  row: typeof projectEstimateLines.$inferSelect,
  costItems: readonly (typeof projectEstimateLineCostItems.$inferSelect)[]
): ProjectEstimateLineItem {
  return {
    assemblyId: row.assemblyId,
    id: row.id,
    reportPhaseId: row.reportPhaseId,
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
    costItems: costItems.map((item) => ({
      id: item.id,
      divisionCode: item.divisionCode,
      divisionName: item.divisionName,
      costCode: item.costCode,
      costCodeName: item.costCodeName,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unitCostCents: item.unitCostCents,
      directCostCents: item.directCostCents,
      markupRateBasisPoints: item.markupRateBasisPoints,
      markupCents: item.markupCents,
      taxable: item.taxable,
      taxEntityId: item.taxEntityId,
      taxCode: item.taxCode,
      taxName: item.taxName,
      taxRateBasisPoints: item.taxRateBasisPoints,
      taxCents: item.taxCents,
      lineTotalCents: item.lineTotalCents,
      totalCostCents: item.totalCostCents,
      sortOrder: item.sortOrder,
      rateBookEntryId: item.rateBookEntryId,
      rateBookVersion: item.rateBookVersion,
    })),
  }
}

export function builderFeeComparisonLines(
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

export function activeEstimate(
  estimates: readonly ProjectEstimateSummary[],
  estimateId?: string
): ProjectEstimateSummary | null {
  if (estimateId) {
    return estimates.find((estimate) => estimate.id === estimateId) ?? null
  }
  const inProgress = (estimate: ProjectEstimateSummary): boolean =>
    ["draft", "internal_review", "signature_pending"].includes(estimate.status)
  // Once an estimate is accepted, open it, or a newer version of it being
  // revised. Unrelated drafts (e.g. an old import) don't take over the page.
  const accepted = estimates.find((estimate) => estimate.status === "accepted")
  if (accepted) {
    return (
      estimates.find(
        (estimate) =>
          inProgress(estimate) &&
          estimate.estimateNumber === accepted.estimateNumber &&
          estimate.versionNumber > accepted.versionNumber
      ) ?? accepted
    )
  }
  return estimates.find(inProgress) ?? estimates[0] ?? null
}
