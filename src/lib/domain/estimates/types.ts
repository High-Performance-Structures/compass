import type { VersionDifferenceLine } from "@/lib/change-orders/version-difference"
import type { EstimateAssembly } from "@/lib/estimates/assemblies"
import type { BuildertrendEstimateLine, BuildertrendEstimatePhase } from "@/lib/estimates/buildertrend-estimate-import"
import type { EstimateClientReportMode, EstimateTextTemplateType } from "@/lib/estimates/client-report"
import type { EstimateMode } from "@/lib/estimates/estimate-modes"
import type { EstimateReportPhase } from "@/lib/estimates/report-phases"
import type { EstimateVersionComparison } from "@/lib/estimates/version-comparison"
import type { ProjectDepartment } from "@/lib/project-branding"

/** The estimate workspace's records, inputs and action results. */

export type ProjectEstimateSummary = {
  readonly id: string
  /** Set for a change-order estimate (see project_estimates.change_order_id). */
  readonly changeOrderId: string | null
  /** Set for a phase proposal's estimate (see project_estimates.phase_proposal_id). */
  readonly phaseProposalId: string | null
  readonly estimateNumber: string
  readonly versionNumber: number
  readonly title: string
  readonly status: string
  readonly estimateDate: string | null
  readonly clientName: string | null
  readonly clientMailingAddress: string | null
  readonly clientSignerContactId: string | null
  readonly clientSignerName: string | null
  readonly clientSignerTitle: string | null
  readonly clientSignerEmail: string | null
  readonly clientSigners: readonly ProjectEstimateSigner[]
  readonly companySignerContactId: string | null
  readonly companySignerName: string | null
  readonly companySignerTitle: string | null
  readonly companySignerEmail: string | null
  readonly companySignerInitials: string | null
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
  readonly showCostBreakdowns: boolean
  readonly showAssemblyBuilderFee: boolean
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
  readonly foxitEmbeddedSessionUrl: string | null
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

export type ProjectEstimateSigner = {
  readonly contactId: string | null
  readonly name: string
  readonly title: string
  readonly email: string
  readonly initials: string
}

export type ProjectEstimateLineItem = {
  readonly assemblyId: string | null
  readonly id: string
  readonly reportPhaseId: string | null
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
  readonly costItems: readonly ProjectEstimateLineCostItem[]
}

export type ProjectEstimateLineCostItem = {
  readonly id: string
  readonly divisionCode: string
  readonly divisionName: string
  readonly costCode: string
  readonly costCodeName: string
  readonly description: string
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
  readonly totalCostCents: number
  readonly sortOrder: number
  /** Rate book entry and version that filled this item, if any. */
  readonly rateBookEntryId: string | null
  readonly rateBookVersion: number | null
}

type ProjectEstimateBasisItem = {
  readonly id: string
  readonly projectDocumentId: string | null
  readonly documentType: string
  readonly title: string
  readonly documentDate: string | null
  readonly revision: string | null
  readonly driveUrl: string | null
  readonly notes: string | null
  readonly sortOrder: number
}

type ProjectEstimateDocumentOption = {
  readonly id: string
  readonly category: string
  readonly title: string
  readonly documentDate: string | null
  readonly revision: string | null
  readonly status: string
  readonly sourceUrl: string | null
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

type ProjectEstimatePhaseDescriptionItem = {
  readonly divisionCode: string
  readonly description: string
}

type ProjectEstimateAcknowledgementItem = {
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
  readonly canDelete: boolean
  readonly projectNumber: string | null
  readonly projectName: string
  readonly projectAddress: string | null
  readonly projectMailingAddress: string | null
  readonly department: ProjectDepartment
  /** "multiple": this department allows several estimates per job. */
  readonly estimateMode: EstimateMode
  readonly reportMode: EstimateClientReportMode
  /**
   * The versions shown: the contract estimate's, or, when a change-order
   * estimate is open, that change order's estimate versions.
   */
  readonly estimates: readonly ProjectEstimateSummary[]
  readonly activeEstimate: ProjectEstimateSummary | null
  /** The change order when the open estimate is a change-order estimate. */
  readonly changeOrder: { readonly id: string; readonly number: string; readonly title: string; readonly status: string } | null
  readonly assemblies: readonly EstimateAssembly[]
  readonly lines: readonly ProjectEstimateLineItem[]
  readonly basisDocuments: readonly ProjectEstimateBasisItem[]
  readonly projectDocumentOptions: readonly ProjectEstimateDocumentOption[]
  readonly costCodes: readonly ProjectEstimateCostCodeOption[]
  readonly taxEntities: readonly ProjectEstimateTaxOption[]
  readonly termsTemplates: readonly ProjectEstimateTermsOption[]
  readonly introductionTemplates: readonly ProjectEstimateTermsOption[]
  readonly closingTemplates: readonly ProjectEstimateTermsOption[]
  readonly acknowledgementTemplates: readonly ProjectEstimateTermsOption[]
  readonly phaseDescriptions: readonly ProjectEstimatePhaseDescriptionItem[]
  readonly reportPhases: readonly EstimateReportPhase[]
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
  /** Required when a newer contract version meets an accepted contract. */
  readonly versionTreatment: string | null
  readonly versionSummary: string | null
}

export type ContractVersionAcceptancePreview =
  | { readonly replacesContract: false }
  | {
      readonly replacesContract: true
      readonly baseline: {
        readonly estimateNumber: string
        readonly versionNumber: number
        readonly totalCents: number
      }
      readonly newTotalCents: number
      readonly netChangeCents: number
      readonly lines: readonly VersionDifferenceLine[]
      /** Why "Replace the contract" can't be chosen yet; empty when it can. */
      readonly replaceBlockers: readonly string[]
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
  readonly clientMailingAddress: string | null
  readonly clientSignerContactId: string | null
  readonly clientSignerName: string | null
  readonly clientSignerTitle: string | null
  readonly clientSignerEmail: string | null
  readonly clientSigners: readonly ProjectEstimateSigner[]
  readonly companySignerContactId: string | null
  readonly companySignerName: string | null
  readonly companySignerTitle: string | null
  readonly companySignerEmail: string | null
  readonly companySignerInitials: string | null
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
  readonly assemblyId: string | null
  readonly reportPhaseId: string | null
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
  /**
   * "Priced by" choice id. Omitted keeps the line's current choice; null clears
   * it. A line with a choice may be saved before its price is known.
   */
  readonly pricingSource?: string | null
}

export type ProjectEstimateLineCostItemInput = {
  readonly costCode: string | null
  readonly description: string | null
  readonly quantity: number | null
  readonly unit: string | null
  readonly unitCost: number | null
  readonly markupPercent: number | null
  readonly taxable: boolean
  readonly taxEntityId: string | null
  /** Set when the item was filled from the rate book. */
  readonly rateBookEntryId?: string | null
  readonly rateBookVersion?: number | null
}

export type ProjectEstimateBuilderFeeInput = {
  readonly overheadPercent: number | null
  readonly marginPercent: number | null
  readonly contingencyPercent: number | null
}

export type ProjectEstimateBasisInput = {
  readonly projectDocumentId: string | null
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

export type ProjectEstimateFoxitPreparationResult =
  | {
      readonly success: true
      readonly id: string
      readonly embeddedSessionUrl: string
    }
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

type ProjectEstimatePlanSwiftImportLine = {
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

export type ProjectEstimateBuildertrendImportInput = {
  readonly sourceFileName: string
  /** Replace the estimate's existing lines and report phases. */
  readonly replaceExisting: boolean
  readonly lines: readonly BuildertrendEstimateLine[]
  readonly phases: readonly BuildertrendEstimatePhase[]
}
