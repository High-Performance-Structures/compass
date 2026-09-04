import { describe, expect, it } from "vitest"

import {
  changeOrderAffectsBudgetAsAdjustment,
  isChangeOrderBudgetTreatment,
  preconstructionRebaselineBlockers,
  rebaselineEstimateDocumentLinks,
} from "@/lib/change-orders/rebaseline"

describe("preconstruction estimate rebaseline", () => {
  it("keeps baseline replacements out of additive budget changes", () => {
    expect(changeOrderAffectsBudgetAsAdjustment("additive")).toBe(true)
    expect(changeOrderAffectsBudgetAsAdjustment("baseline_replacement")).toBe(
      false
    )
    expect(isChangeOrderBudgetTreatment("baseline_replacement")).toBe(true)
    expect(isChangeOrderBudgetTreatment("other")).toBe(false)
  })

  it("reports every downstream financial blocker", () => {
    expect(
      preconstructionRebaselineBlockers({
        ownerAudience: false,
        replacementEstimateFrozen: false,
        replacementEstimateHasLines: true,
        currentBaselineMatches: true,
        hasActualCosts: true,
        hasPurchaseOrders: true,
        hasVendorBills: true,
        hasInvoicesOrPayments: true,
        hasPaymentApplications: true,
        hasPriorExecutedAdjustments: true,
      })
    ).toHaveLength(8)
  })

  it("allows a frozen replacement before project financial activity begins", () => {
    expect(
      preconstructionRebaselineBlockers({
        ownerAudience: true,
        replacementEstimateFrozen: true,
        replacementEstimateHasLines: true,
        currentBaselineMatches: true,
        hasActualCosts: false,
        hasPurchaseOrders: false,
        hasVendorBills: false,
        hasInvoicesOrPayments: false,
        hasPaymentApplications: false,
        hasPriorExecutedAdjustments: false,
      })
    ).toEqual([])
  })

  it("builds the replacement estimate and comparison document links", () => {
    expect(
      rebaselineEstimateDocumentLinks({
        projectId: "project one",
        baselineEstimateId: "estimate/base",
        replacementEstimateId: "estimate revised",
      })
    ).toEqual({
      replacementEstimateUrl:
        "/api/projects/project%20one/estimates/estimate%20revised/pdf",
      comparisonUrl:
        "/print/projects/project%20one/estimate/compare?baseEstimateId=estimate%2Fbase&revisedEstimateId=estimate%20revised",
    })
  })
})
