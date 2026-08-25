import { describe, expect, it } from "vitest"

import {
  buildContractBudget,
  calculateEstimateLine,
  calculateEstimateLineBreakdownRollup,
  calculateEstimateLineBreakdownSubtotal,
  calculateEstimateLineCostItemTotal,
  calculateEstimateTotals,
  estimateCanBeAccepted,
  estimateCanBeEdited,
  estimateSourceHash,
  type EstimateLedgerLine,
} from "@/lib/financials/estimate-ledger"

function estimateLine(
  input: Partial<EstimateLedgerLine> & Pick<EstimateLedgerLine, "id">
): EstimateLedgerLine {
  return {
    id: input.id,
    divisionCode: input.divisionCode ?? "03",
    divisionName: input.divisionName ?? "Concrete",
    costCode: input.costCode ?? "03 11 13",
    description: input.description ?? "Forming boards",
    directCostCents: input.directCostCents ?? 100_000,
    markupCents: input.markupCents ?? 10_000,
    taxCents: input.taxCents ?? 5_500,
    lineTotalCents: input.lineTotalCents ?? 115_500,
    ownerVisible: input.ownerVisible ?? true,
    includeInBuilderFee: input.includeInBuilderFee ?? true,
    sortOrder: input.sortOrder ?? 1,
  }
}

describe("estimate ledger", () => {
  it("calculates line markup and tax without floating point drift", () => {
    expect(
      calculateEstimateLine({
        quantity: 2.5,
        unitCostCents: 12_345,
        markupRateBasisPoints: 1_500,
        taxable: true,
        taxRateBasisPoints: 513,
      })
    ).toEqual({
      directCostCents: 30_863,
      markupCents: 4_629,
      taxCents: 1_821,
      lineTotalCents: 37_313,
    })
  })

  it("preserves fractional basis points from Sage tax districts", () => {
    expect(
      calculateEstimateLine({
        quantity: 1,
        unitCostCents: 1_000_000,
        markupRateBasisPoints: 0,
        taxable: true,
        taxRateBasisPoints: 518.5,
      })
    ).toMatchObject({
      taxCents: 51_850,
      lineTotalCents: 1_051_850,
    })
  })

  it("rolls detailed cost codes into a parent line subtotal", () => {
    expect(
      calculateEstimateLineCostItemTotal({
        quantity: 37.5,
        unitCostCents: 1_289,
      })
    ).toBe(48_338)
    expect(
      calculateEstimateLineBreakdownSubtotal([
        { quantity: 37.5, unitCostCents: 1_289 },
        { quantity: 12, unitCostCents: 2_560 },
      ])
    ).toBe(79_058)
  })

  it("rolls mixed taxable Fox items into the parent without taxing twice", () => {
    const taxableFoxItem = calculateEstimateLine({
      quantity: 1,
      unitCostCents: 100_000,
      markupRateBasisPoints: 1_000,
      taxable: true,
      taxRateBasisPoints: 513,
    })
    const nonTaxableFoxItem = calculateEstimateLine({
      quantity: 1,
      unitCostCents: 100_000,
      markupRateBasisPoints: 0,
      taxable: false,
      taxRateBasisPoints: 0,
    })

    expect(
      calculateEstimateLineBreakdownRollup([
        {
          ...taxableFoxItem,
          markupRateBasisPoints: 1_000,
          taxable: true,
          taxEntityId: "littens-tax",
          taxCode: "LITTEN",
          taxName: "Litten tax district",
          taxRateBasisPoints: 513,
        },
        {
          ...nonTaxableFoxItem,
          markupRateBasisPoints: 0,
          taxable: false,
          taxEntityId: null,
          taxCode: null,
          taxName: null,
          taxRateBasisPoints: 0,
        },
      ])
    ).toEqual({
      directCostCents: 200_000,
      markupRateBasisPoints: 0,
      markupCents: 10_000,
      taxable: true,
      taxEntityId: "littens-tax",
      taxCode: "LITTEN",
      taxName: "Litten tax district",
      taxRateBasisPoints: 513,
      taxCents: 5_643,
      lineTotalCents: 215_643,
    })
  })

  it("rolls estimate totals once across all lines", () => {
    expect(
      calculateEstimateTotals([
        estimateLine({ id: "one" }),
        estimateLine({
          id: "two",
          directCostCents: 20_000,
          markupCents: 0,
          taxCents: 0,
          lineTotalCents: 20_000,
        }),
      ])
    ).toEqual({
      directCostCents: 120_000,
      markupCents: 10_000,
      taxCents: 5_500,
      builderFeeBaseCents: 135_500,
      overheadCents: 0,
      marginCents: 0,
      contingencyCents: 0,
      builderFeeCents: 0,
      estimateTotalCents: 135_500,
    })
  })

  it("applies builder-fee rates only to eligible line totals", () => {
    expect(
      calculateEstimateTotals(
        [
          estimateLine({ id: "eligible", lineTotalCents: 100_000 }),
          estimateLine({
            id: "excluded",
            lineTotalCents: 50_000,
            includeInBuilderFee: false,
          }),
        ],
        {
          overheadRateBasisPoints: 800,
          marginRateBasisPoints: 700,
          contingencyRateBasisPoints: 200,
        }
      )
    ).toMatchObject({
      builderFeeBaseCents: 100_000,
      overheadCents: 8_000,
      marginCents: 7_000,
      contingencyCents: 2_000,
      builderFeeCents: 17_000,
      estimateTotalCents: 167_000,
    })
  })

  it("builds a contract budget from accepted lines and executed changes", () => {
    const budget = buildContractBudget({
      estimateLines: [
        estimateLine({ id: "line-a", lineTotalCents: 100_000 }),
        estimateLine({
          id: "line-b",
          lineTotalCents: 50_000,
          costCode: "03 11 13",
        }),
        estimateLine({
          id: "line-c",
          divisionCode: "09",
          divisionName: "Finishes",
          costCode: "09 91 00",
          description: "Painting",
          lineTotalCents: 75_000,
          sortOrder: 2,
        }),
      ],
      adjustments: [
        {
          id: "co-line-1",
          changeOrderId: "co-1",
          costCode: "03 11 13",
          description: "Additional forming",
          amountCents: 10_000,
          executedAt: "2026-08-01T10:00:00.000Z",
        },
        {
          id: "co-line-2",
          changeOrderId: "co-2",
          costCode: "26 00 00",
          description: "Added electrical scope",
          amountCents: 20_000,
          executedAt: "2026-08-01T11:00:00.000Z",
        },
      ],
    })

    expect(budget.originalContractSumCents).toBe(225_000)
    expect(budget.approvedChangesCents).toBe(30_000)
    expect(budget.revisedContractSumCents).toBe(255_000)
    expect(budget.lines).toHaveLength(3)
    expect(budget.lines[0]).toMatchObject({
      costCode: "03 11 13",
      originalEstimateCents: 150_000,
      approvedChangeCents: 10_000,
      adjustedBudgetCents: 160_000,
    })
  })

  it("locks accepted and signature-pending estimates", () => {
    expect(estimateCanBeEdited("draft")).toBe(true)
    expect(estimateCanBeEdited("accepted")).toBe(false)
    expect(
      estimateCanBeAccepted({
        status: "signature_pending",
        foxitStatus: "completed",
        lineCount: 1,
      })
    ).toBe(true)
    expect(
      estimateCanBeAccepted({
        status: "signature_pending",
        foxitStatus: "handoff_ready",
        lineCount: 1,
      })
    ).toBe(false)
  })

  it("hashes the full signed estimate basis, not only its totals", async () => {
    const input = {
      estimateId: "estimate-1",
      versionNumber: 1,
      title: "CA22 Construction Estimate",
      reportMode: "ca22",
      introductionText: "Thank you for the opportunity to estimate the work.",
      contractTerms: "Base terms",
      closingText: "Please contact us with any questions.",
      signers: {
        clients: [{
          name: "Alex Owner",
          title: "Owner",
          email: "alex@example.com",
          initials: "AO",
        }],
        company: {
          name: "Jordan Builder",
          title: "Project Manager",
          email: "jordan@example.com",
          initials: "JB",
        },
      },
      overheadRateBasisPoints: 800,
      marginRateBasisPoints: 700,
      contingencyRateBasisPoints: 200,
      lines: [
        {
          id: "line-1",
          divisionCode: "03",
          costCode: "03 11 13",
          description: "Concrete forming",
          specifications: "Per architectural plans",
          quantity: 1,
          unit: "LS",
          unitCostCents: 100_000,
          markupRateBasisPoints: 1_000,
          taxable: false,
          taxCode: null,
          taxRateBasisPoints: 0,
          lineTotalCents: 110_000,
          ownerVisible: true,
          includeInBuilderFee: true,
          sortOrder: 1,
        },
      ],
      basisDocuments: [
        {
          id: "basis-1",
          documentType: "architectural_plans",
          title: "Architectural plans",
          documentDate: "2026-07-15",
          revision: "A",
          driveFileId: "drive-1",
          driveUrl: "https://drive.google.com/file/d/drive-1/view",
          notes: null,
          sortOrder: 1,
        },
      ],
      phaseDescriptions: [
        { divisionCode: "03", description: "Concrete structure" },
      ],
      acknowledgements: [],
    }
    const original = await estimateSourceHash(input)
    const revised = await estimateSourceHash({
      ...input,
      lines: [{ ...input.lines[0], specifications: "Per revision B" }],
    })
    const differentBasis = await estimateSourceHash({
      ...input,
      basisDocuments: [
        { ...input.basisDocuments[0], documentDate: "2026-07-31" },
      ],
    })
    const differentPresentation = await estimateSourceHash({
      ...input,
      phaseDescriptions: [
        { divisionCode: "03", description: "Concrete foundations" },
      ],
    })
    const differentSigner = await estimateSourceHash({
      ...input,
      signers: {
        ...input.signers,
        company: { ...input.signers.company, name: "Taylor Builder" },
      },
    })

    expect(revised).not.toBe(original)
    expect(differentBasis).not.toBe(original)
    expect(differentPresentation).not.toBe(original)
    expect(differentSigner).not.toBe(original)
  })
})
