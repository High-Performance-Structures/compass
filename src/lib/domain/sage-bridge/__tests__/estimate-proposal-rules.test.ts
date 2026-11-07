import { describe, expect, it } from "vitest"

import { planSageEstimate } from "@/lib/domain/sage-bridge/estimate-proposal-rules"
import type { SageCostCodeMapping } from "@/lib/financials/sage-export-codes"
import { sageEstimateWritePayload } from "@/lib/sage/estimate-write"

const RECORDS: Record<string, string> = {
  "03 30 00": "3300000",
  "06 10 00": "6100000",
  "Company Overhead": "34",
  "Company Margin": "33",
}

function mapCostCode(costCode: string): SageCostCodeMapping {
  const record = RECORDS[costCode]
  return record
    ? { status: "mapped", by: "csi_prefix", sageName: `${costCode} - Example`, sageRecordNumber: record }
    : { status: "unmapped", reason: "No match." }
}

const CONTRACT = [
  { costCode: "03 30 00", description: "Concrete", amountCents: 1_000_000 },
  { costCode: "06 10 00", description: "Framing", amountCents: 500_000 },
  { costCode: "99 10 00", description: "Overhead", amountCents: 75_000 },
  { costCode: "Company Margin", description: "Margin", amountCents: 60_000 },
  { costCode: "03 31 00", description: "Zero line", amountCents: 0 },
]

const BASE = {
  contractLines: CONTRACT,
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
  it("sends one line per contract budget line, fees on their Sage fee codes, totalling the contract", () => {
    const plan = planSageEstimate(BASE)
    expect(plan.blockers).toEqual([])
    expect(plan.proposalLines.map((line) => [line.costCode, line.sageCostCodeRecord, line.amountCents])).toEqual([
      ["03 30 00", "3300000", 1_000_000],
      ["06 10 00", "6100000", 500_000],
      ["Company Overhead", "34", 75_000],
      ["Company Margin", "33", 60_000],
    ])
    expect(plan.proposalTotalCents).toBe(1_635_000)
    expect(plan.budgetLines).toBeNull()
  })

  it("puts the whole amount in Other and builds the budget at cost only when the company sends it", () => {
    const plan = planSageEstimate({ ...BASE, sendBudget: true })
    expect(plan.budgetLines?.map((line) => [line.costCode, line.amountCents])).toEqual([
      ["03 30 00", 850_000],
      ["06 10 00", 400_000],
    ])
    const payload = sageEstimateWritePayload(plan, { projectId: "p", estimateId: "e", sageJobNumber: "1200", sageJobId: null })
    expect(payload?.proposal).toMatchObject({ totalAmount: "16350.00", lines: [{ costCodeRecordNumber: "3300000", otherAmount: "10000.00" }, {}, {}, {}] })
    expect(payload?.budget?.totalAmount).toBe("12500.00")
  })

  it("blocks and lists lines without a Sage cost code", () => {
    const plan = planSageEstimate({
      ...BASE,
      contractLines: [...CONTRACT, { costCode: "02 00 00", description: "Unknown work", amountCents: 1_000 }],
      contractTotalCents: 1_636_000,
    })
    expect(plan.unmappedLines).toEqual(["02 00 00 ($10.00)"])
    expect(plan.blockers[0]).toContain("no Sage cost code")
    expect(sageEstimateWritePayload(plan, { projectId: "p", estimateId: "e", sageJobNumber: "1200", sageJobId: null })).toBeNull()
  })

  it("sends an assembly-view estimate by division and cost code only, with Sage names and fees on their fee codes", () => {
    const records: Record<string, string> = {
      "01 71 13": "1711300",
      "03 11 19": "3111900",
      "03 30 02": "3300200",
      "06 10 00": "6100000",
      "Company Overhead": "34",
      "Company Margin": "33",
      "Contingency Reserve": "35",
    }
    const map = (costCode: string): SageCostCodeMapping => {
      const record = records[costCode]
      return record
        ? { status: "mapped", by: "csi_prefix", sageName: `${costCode} - Sage name`, sageRecordNumber: record }
        : { status: "unmapped", reason: "No match." }
    }
    // Lines carry assembly and item text and arrive out of order, some sharing a cost code.
    const contractLines = [
      { costCode: "Contingency Reserve", description: "Contingency", amountCents: 12_345 },
      { costCode: "06 10 00", description: "Deck assembly: framing", amountCents: 300_001 },
      { costCode: "03 30 02", description: "Foundation assembly: wall labor", amountCents: 450_000 },
      { costCode: "99 10 00", description: "Overhead", amountCents: 40_000 },
      { costCode: "01 71 13", description: "Foundation assembly: mileage", amountCents: 20_000 },
      { costCode: "03 11 19", description: "Foundation assembly: forms", amountCents: 125_555 },
      { costCode: "03 30 02", description: "Deck assembly: footings", amountCents: 50_000 },
      { costCode: "Company Margin", description: "Margin", amountCents: 33_333 },
      { costCode: "01 71 13", description: "Deck assembly: mileage", amountCents: 5_000 },
    ]
    const contractTotalCents = contractLines.reduce((sum, line) => sum + line.amountCents, 0)
    const plan = planSageEstimate({ ...BASE, contractLines, contractTotalCents, mapCostCode: map })
    expect(plan.blockers).toEqual([])
    expect(plan.proposalLines.map((line) => [line.costCode, line.sageCostCodeRecord, line.amountCents])).toEqual([
      ["01 71 13", "1711300", 25_000],
      ["03 11 19", "3111900", 125_555],
      ["03 30 02", "3300200", 500_000],
      ["06 10 00", "6100000", 300_001],
      ["Company Overhead", "34", 40_000],
      ["Company Margin", "33", 33_333],
      ["Contingency Reserve", "35", 12_345],
    ])
    expect(plan.proposalLines.every((line) => !line.description.includes("assembly"))).toBe(true)
    expect(plan.proposalLines[0]?.description).toBe("01 71 13 - Sage name")
    expect(plan.proposalTotalCents).toBe(contractTotalCents)
  })

  it("blocks when the lines don't equal the contract total", () => {
    expect(planSageEstimate({ ...BASE, contractTotalCents: 1 }).blockers[0]).toContain("contract total")
  })

  it("never adds a second proposal, and says what Sage has", () => {
    const plan = planSageEstimate({ ...BASE, sageProposal: { lineCount: 25, totalCents: 1_635_000 } })
    expect(plan.blockers).toEqual([expect.stringContaining("Sage already has a proposal for this job (25 lines, $16,350.00)")])
    expect(planSageEstimate({ ...BASE, sageProposal: { lineCount: 0, totalCents: 0 } }).blockers).toEqual([])
  })
})
