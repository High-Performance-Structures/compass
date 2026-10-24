import { describe, expect, it } from "vitest"

import { payApplicationChangeOrderSummary, payApplicationReport } from "../pay-application-report"

const base = {
  divisionCode: "03",
  divisionName: "Concrete",
  priorChanges: 0,
  currentChanges: 0,
  previousWorkCompleted: 0,
  storedMaterials: 0,
  ownerVisible: true,
}

const sources = [
  { ...base, costCode: "03 31 00", description: "Structural Concrete", assemblyKey: "asm:footer", assemblyName: "Footer", assemblySort: 1, originalEstimate: 30_000, currentWorkCompleted: 30_000 },
  { ...base, costCode: "03 21 00", description: "Reinforcing Steel", assemblyKey: "asm:footer", assemblyName: "Footer", assemblySort: 1, originalEstimate: 10_000, currentWorkCompleted: 5_000 },
  { ...base, costCode: "03 21 00", description: "Reinforcing Steel", assemblyKey: "asm:icf", assemblyName: "ICF Walls", assemblySort: 2, originalEstimate: 60_000, currentWorkCompleted: 0 },
  { ...base, costCode: "07 10 00", description: "Waterproofing", divisionCode: "07", divisionName: "Thermal and Moisture Protection", assemblyKey: "co:1", assemblyName: "Change order CO-001", assemblySort: 500_000, originalEstimate: 0, currentChanges: 1_700, currentWorkCompleted: 0 },
  { ...base, costCode: "01 00 00", description: "Hidden", assemblyKey: null, assemblyName: null, assemblySort: 0, originalEstimate: 999, currentWorkCompleted: 0, ownerVisible: false },
]

describe("payApplicationReport", () => {
  it("prints one combined row per assembly at the percent level", () => {
    const report = payApplicationReport(sources, "assembly_percent")
    expect(report.groupLabel).toBe("Assembly")
    expect(report.groups.map((group) => [group.label, group.adjustedEstimate, group.completedToDate, group.percentComplete, group.rows.length])).toEqual([
      ["Footer", 40_000, 35_000, 87.5, 0],
      ["ICF Walls", 60_000, 0, 0, 0],
      ["Change order CO-001", 1_700, 0, 0, 0],
    ])
  })

  it("lists cost codes under each division at the itemized level", () => {
    const report = payApplicationReport(sources, "division")
    expect(report.groups.map((group) => group.label)).toEqual(["03 · Concrete", "07 · Thermal and Moisture Protection"])
    expect(report.groups[0]?.rows.map((row) => [row.label, row.adjustedEstimate])).toEqual([
      ["03 21 00 · Reinforcing Steel", 70_000],
      ["03 31 00 · Structural Concrete", 30_000],
    ])
  })

  it("combines assembly rows by cost code and leaves out hidden rows", () => {
    const report = payApplicationReport(sources, "cost_code")
    expect(report.groups).toHaveLength(3)
    expect(report.totals.originalContractSum).toBe(100_000)
    expect(report.totals.currentChanges).toBe(1_700)
    expect(report.totals.adjustedEstimate).toBe(101_700)
    expect(report.totals.balance).toBe(66_700)
  })
})

describe("payApplicationChangeOrderSummary", () => {
  it("names this period's change orders", () => {
    expect(payApplicationChangeOrderSummary(sources)).toEqual({
      previous: 0,
      current: 1_700,
      currentItems: [{ name: "Change order CO-001", amount: 1_700, assemblies: [] }],
    })
  })

  it("names change orders that landed inside an assembly from the change-order list", () => {
    const list = [
      { name: "CO-000 · Earlier", amount: 400, current: false, assemblies: [] },
      { name: "CO-001 · Plan revisions", amount: 1_700, current: true, assemblies: [{ name: "Kitchen", amount: 2_000 }, { name: "Framing", amount: -300 }] },
    ]
    expect(payApplicationChangeOrderSummary(sources, list).currentItems).toEqual([
      { name: "CO-001 · Plan revisions", amount: 1_700, assemblies: [{ name: "Kitchen", amount: 2_000 }, { name: "Framing", amount: -300 }] },
    ])
    // A list that doesn't add up to this period's changes falls back to the rows.
    expect(payApplicationChangeOrderSummary(sources, [{ ...list[1], amount: 99, assemblies: [] }]).currentItems).toEqual([
      { name: "Change order CO-001", amount: 1_700, assemblies: [] },
    ])
  })
})
