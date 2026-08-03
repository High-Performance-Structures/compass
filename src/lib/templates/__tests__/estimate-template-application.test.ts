import { describe, expect, it } from "vitest"

import {
  buildEstimateTemplateApplication,
  type EstimateTemplateSourceLine,
} from "@/lib/templates/estimate-template-application"

function sourceLine(
  overrides: Partial<EstimateTemplateSourceLine> = {}
): EstimateTemplateSourceLine {
  return {
    id: "template-line-1",
    divisionCode: "03",
    divisionName: "Concrete",
    costCode: "03-100",
    costCodeName: "Concrete material",
    description: "Concrete foundations",
    specifications: null,
    quantity: 2,
    unit: "CY",
    unitCostCents: 10_000,
    markupRateBasisPoints: 1_000,
    taxable: false,
    taxCode: null,
    ownerVisible: true,
    sortOrder: 0,
    ...overrides,
  }
}

describe("buildEstimateTemplateApplication", () => {
  it("copies lines and calculates project tax from the selected Sage entity", () => {
    const result = buildEstimateTemplateApplication({
      lines: [sourceLine({ taxable: true })],
      taxEntities: [
        {
          id: "tax-1",
          code: "DENVER",
          name: "Denver sales tax",
          rateBasisPoints: 500,
        },
      ],
      defaultTaxEntityId: "tax-1",
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.lines[0]).toMatchObject({
      templateLineId: "template-line-1",
      directCostCents: 20_000,
      markupCents: 2_000,
      taxCents: 1_100,
      lineTotalCents: 23_100,
      taxCode: "DENVER",
    })
    expect(result.data.totals).toEqual({
      directCostCents: 20_000,
      markupCents: 2_000,
      taxCents: 1_100,
      estimateTotalCents: 23_100,
    })
  })

  it("uses a fixed template tax code ahead of the project default", () => {
    const result = buildEstimateTemplateApplication({
      lines: [sourceLine({ taxable: true, taxCode: "FIXED" })],
      taxEntities: [
        {
          id: "tax-default",
          code: "DEFAULT",
          name: "Default",
          rateBasisPoints: 500,
        },
        {
          id: "tax-fixed",
          code: "FIXED",
          name: "Fixed",
          rateBasisPoints: 750,
        },
      ],
      defaultTaxEntityId: "tax-default",
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.lines[0]?.taxEntityId).toBe("tax-fixed")
    expect(result.data.lines[0]?.taxCents).toBe(1_650)
  })

  it("allows zero-cost draft lines for project-specific pricing", () => {
    const result = buildEstimateTemplateApplication({
      lines: [sourceLine({ unitCostCents: 0 })],
      taxEntities: [],
      defaultTaxEntityId: null,
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.totals.estimateTotalCents).toBe(0)
  })

  it("rejects taxable lines when no matching Sage tax entity exists", () => {
    const result = buildEstimateTemplateApplication({
      lines: [sourceLine({ taxable: true, taxCode: "MISSING" })],
      taxEntities: [],
      defaultTaxEntityId: null,
    })

    expect(result).toEqual({
      success: false,
      error:
        "Template line 03-100 is taxable but no matching Sage tax entity is available.",
    })
  })

  it("rejects empty templates", () => {
    expect(
      buildEstimateTemplateApplication({
        lines: [],
        taxEntities: [],
        defaultTaxEntityId: null,
      })
    ).toEqual({
      success: false,
      error: "The estimate template has no lines.",
    })
  })
})
