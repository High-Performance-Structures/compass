import { describe, expect, it } from "vitest"

import { planSageEstimate, type EstimateProposalLine } from "@/lib/domain/sage-bridge/estimate-proposal-rules"
import type { SageCostCodeMapping } from "@/lib/financials/sage-export-codes"
import { sageEstimateWritePayload } from "@/lib/sage/estimate-write"

const RECORDS: Record<string, string> = {
  "01 71 13": "1711300",
  "03 11 19": "3111900",
  "03 30 00": "3300000",
  "03 30 02": "3300200",
  "06 10 00": "6100000",
  "Company Overhead": "34",
  "Company Margin": "33",
  "Contingency Reserve": "35",
}

function mapCostCode(costCode: string): SageCostCodeMapping {
  const record = RECORDS[costCode]
  return record
    ? { status: "mapped", by: "csi_prefix", sageName: `${costCode} - Sage name`, sageRecordNumber: record }
    : { status: "unmapped", reason: "No match." }
}

let order = 0
function line(costCode: string, description: string, amountCents: number, extra: Partial<EstimateProposalLine> = {}): EstimateProposalLine {
  order += 1
  return {
    costCode,
    costCodeName: `${costCode} name`,
    divisionCode: costCode.slice(0, 2),
    description,
    amountCents,
    sortOrder: order,
    taxable: false,
    taxName: null,
    taxRateBasisPoints: 0,
    ...extra,
  }
}

const LINES = [line("03 30 00", "Footings", 1_000_000), line("06 10 00", "Wall framing", 500_000), line("03 31 00", "Zero line", 0)]
const FEES = [
  { costCode: "99 10 00", amountCents: 75_000 },
  { costCode: "Company Margin", amountCents: 60_000 },
  { costCode: "Contingency Reserve", amountCents: 0 },
]

const BASE = {
  estimateLines: LINES,
  feeLines: FEES,
  contractTotalCents: 1_635_000,
  costLines: [
    { costCode: "03 30 00", costCents: 800_000 },
    { costCode: "03 30 00", costCents: 50_000 },
    { costCode: "06 10 00", costCents: 400_000 },
  ],
  sendBudget: false,
  mapCostCode,
  sageProposal: null,
}

describe("an accepted estimate as a Sage proposal", () => {
  it("sends one line per estimate line, fees on their Sage fee codes, totalling the contract", () => {
    const plan = planSageEstimate(BASE)
    expect(plan.blockers).toEqual([])
    expect(plan.proposalLines.map((planned) => [planned.costCode, planned.sageCostCodeRecord, planned.description, planned.amountCents])).toEqual([
      ["03 30 00", "3300000", "Footings", 1_000_000],
      ["06 10 00", "6100000", "Wall framing", 500_000],
      ["Company Overhead", "34", "Company Overhead - Sage name", 75_000],
      ["Company Margin", "33", "Company Margin - Sage name", 60_000],
    ])
    expect(plan.proposalTotalCents).toBe(1_635_000)
    expect(plan.budgetLines).toBeNull()
  })

  it("puts the whole amount in Other and builds the budget at cost by cost code only when the company sends it", () => {
    const plan = planSageEstimate({ ...BASE, sendBudget: true })
    expect(plan.budgetLines?.map((planned) => [planned.costCode, planned.amountCents])).toEqual([
      ["03 30 00", 850_000],
      ["06 10 00", 400_000],
    ])
    const payload = sageEstimateWritePayload(plan, { projectId: "p", estimateId: "e", sageJobNumber: "1200", sageJobId: null })
    expect(payload?.operationType).toBe("add_job_proposal_lines")
    expect(payload?.proposal).toMatchObject({
      totalAmount: "16350.00",
      lines: [{ costCodeRecordNumber: "3300000", otherAmount: "10000.00", userDefined1: "", memo: "" }, {}, {}, {}],
    })
    expect(payload?.budget?.totalAmount).toBe("12500.00")
    expect(payload?.budget?.lines[0]).toEqual({ description: "03 30 00 - Sage name", costCodeRecordNumber: "3300000", otherAmount: "8500.00" })
  })

  it("blocks and lists cost codes without a Sage record, once per code", () => {
    const plan = planSageEstimate({
      ...BASE,
      estimateLines: [...LINES, line("02 00 00", "Unknown work", 1_000), line("02 00 00", "More unknown work", 500)],
      contractTotalCents: 1_636_500,
    })
    expect(plan.unmappedLines).toEqual(["02 00 00 ($15.00)"])
    expect(plan.blockers[0]).toContain("no Sage cost code")
    expect(sageEstimateWritePayload(plan, { projectId: "p", estimateId: "e", sageJobNumber: "1200", sageJobId: null })).toBeNull()
  })

  it("sends an assembly-view estimate line by line, by division and cost code, with line descriptions and Taxable tags", () => {
    // Lines come from two assemblies, out of order, several to a cost code, some taxable.
    const estimateLines = [
      line("06 10 00", "Deck joists", 300_001),
      line("03 30 02", "Wall pour labor", 450_000),
      line("01 71 13", "Deck crew mileage", 5_000),
      line("03 11 19", "ICF straight blocks", 125_555, { taxable: true, taxName: "Example County Use Tax", taxRateBasisPoints: 290 }),
      line("03 30 02", "Footing pour labor", 50_000),
      line("01 71 13", "Foundation crew mileage", 20_000),
      line("03 11 19", "ICF corner blocks", 64_444, { taxable: true }),
      line("03 11 19", "   ", 10_000),
      line("01 71 13", "A very long line description that goes well past fifty characters", 1_000),
    ]
    const feeLines = [
      { costCode: "Contingency Reserve", amountCents: 12_345 },
      { costCode: "99 10 00", amountCents: 40_000 },
      { costCode: "Company Margin", amountCents: 33_333 },
    ]
    const contractTotalCents = [...estimateLines, ...feeLines].reduce((sum, planned) => sum + planned.amountCents, 0)
    const plan = planSageEstimate({ ...BASE, estimateLines, feeLines, contractTotalCents })
    expect(plan.blockers).toEqual([])
    expect(plan.proposalLines.map((planned) => [planned.sageCostCodeRecord, planned.description, planned.userDefined1, planned.amountCents])).toEqual([
      ["1711300", "Deck crew mileage", "", 5_000],
      ["1711300", "Foundation crew mileage", "", 20_000],
      ["1711300", "A very long line description that goes well past f", "", 1_000],
      ["3111900", "ICF straight blocks", "Taxable", 125_555],
      ["3111900", "ICF corner blocks", "Taxable", 64_444],
      ["3111900", "03 11 19 name", "", 10_000],
      ["3300200", "Wall pour labor", "", 450_000],
      ["3300200", "Footing pour labor", "", 50_000],
      ["6100000", "Deck joists", "", 300_001],
      ["34", "Company Overhead - Sage name", "", 40_000],
      ["33", "Company Margin - Sage name", "", 33_333],
      ["35", "Contingency Reserve - Sage name", "", 12_345],
    ])
    expect(plan.proposalLines[3]?.memo).toBe("Example County Use Tax 2.9%")
    expect(plan.proposalLines[4]?.memo).toBe("")
    expect(plan.proposalLines.every((planned) => planned.description.length <= 50)).toBe(true)
    expect(plan.proposalTotalCents).toBe(contractTotalCents)
    const payload = sageEstimateWritePayload(plan, { projectId: "p", estimateId: "e", sageJobNumber: "1200", sageJobId: null })
    expect(payload?.proposal.lines[3]).toMatchObject({ userDefined1: "Taxable", memo: "Example County Use Tax 2.9%" })
    expect(payload?.proposal.lines).toHaveLength(12)
  })

  it("puts a rounding remainder on the largest line, and blocks a real difference", () => {
    const rounded = planSageEstimate({ ...BASE, contractTotalCents: 1_635_002 })
    expect(rounded.blockers).toEqual([])
    expect(rounded.proposalLines.map((planned) => planned.amountCents)).toEqual([1_000_002, 500_000, 75_000, 60_000])
    expect(planSageEstimate({ ...BASE, contractTotalCents: 1 }).blockers[0]).toContain("contract total")
  })

  it("never adds a second proposal, and says what Sage has", () => {
    const plan = planSageEstimate({ ...BASE, sageProposal: { lineCount: 25, totalCents: 1_635_000 } })
    expect(plan.blockers).toEqual([expect.stringContaining("Sage already has a proposal for this job (25 lines, $16,350.00)")])
    expect(planSageEstimate({ ...BASE, sageProposal: { lineCount: 0, totalCents: 0 } }).blockers).toEqual([])
  })
})
