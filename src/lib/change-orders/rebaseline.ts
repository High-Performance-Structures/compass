export type ChangeOrderBudgetTreatment =
  | "additive"
  | "baseline_replacement"

export type PreconstructionRebaselineEvidence = {
  readonly ownerAudience: boolean
  readonly replacementEstimateFrozen: boolean
  readonly replacementEstimateHasLines: boolean
  readonly currentBaselineMatches: boolean
  readonly hasActualCosts: boolean
  readonly hasPurchaseOrders: boolean
  readonly hasVendorBills: boolean
  readonly hasInvoicesOrPayments: boolean
  readonly hasPaymentApplications: boolean
  readonly hasPriorExecutedAdjustments: boolean
}

export function isChangeOrderBudgetTreatment(
  value: string
): value is ChangeOrderBudgetTreatment {
  return value === "additive" || value === "baseline_replacement"
}

export function changeOrderBudgetTreatmentLabel(
  treatment: ChangeOrderBudgetTreatment
): string {
  return treatment === "baseline_replacement"
    ? "Baseline replacement"
    : "Budget adjustment"
}

export function changeOrderAffectsBudgetAsAdjustment(
  treatment: ChangeOrderBudgetTreatment
): boolean {
  return treatment === "additive"
}

export function preconstructionRebaselineBlockers(
  evidence: PreconstructionRebaselineEvidence
): readonly string[] {
  const blockers: string[] = []
  if (!evidence.ownerAudience) {
    blockers.push("The rebaseline amendment must be owner visible before signature.")
  }
  if (!evidence.currentBaselineMatches) {
    blockers.push("The linked original estimate is no longer the current baseline.")
  }
  if (!evidence.replacementEstimateHasLines) {
    blockers.push("The replacement estimate must contain at least one line.")
  }
  if (!evidence.replacementEstimateFrozen) {
    blockers.push(
      "Freeze the replacement estimate for outside signature before executing the amendment."
    )
  }
  if (evidence.hasActualCosts) {
    blockers.push("Posted project costs or completed work already exist.")
  }
  if (evidence.hasPurchaseOrders) {
    blockers.push("A non-void purchase order already exists for this project.")
  }
  if (evidence.hasVendorBills) {
    blockers.push("A vendor bill already exists for this project.")
  }
  if (evidence.hasInvoicesOrPayments) {
    blockers.push("An invoice or payment already exists for this project.")
  }
  if (evidence.hasPaymentApplications) {
    blockers.push("A payment application already exists for this project.")
  }
  if (evidence.hasPriorExecutedAdjustments) {
    blockers.push(
      "An executed additive change order already affects the current baseline."
    )
  }
  return blockers
}

export function rebaselineEstimateDocumentLinks(input: {
  readonly projectId: string
  readonly baselineEstimateId: string
  readonly replacementEstimateId: string
}): {
  readonly replacementEstimateUrl: string
  readonly comparisonUrl: string
} {
  const projectId = encodeURIComponent(input.projectId)
  const baselineEstimateId = encodeURIComponent(input.baselineEstimateId)
  const replacementEstimateId = encodeURIComponent(input.replacementEstimateId)
  return {
    replacementEstimateUrl:
      `/api/projects/${projectId}/estimates/${replacementEstimateId}/pdf`,
    comparisonUrl:
      `/print/projects/${projectId}/estimate/compare` +
      `?baseEstimateId=${baselineEstimateId}` +
      `&revisedEstimateId=${replacementEstimateId}`,
  }
}
