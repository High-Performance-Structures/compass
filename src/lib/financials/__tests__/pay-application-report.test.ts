import { describe, expect, it } from "vitest"

import { payApplicationChangeSummary, payApplicationReport } from "../pay-application-report"

const base = {
  divisionCode: "03",
  divisionName: "Concrete",
  priorChanges: 0,
  currentChanges: 0,
  totalVariances: 0,
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
    expect(report.totals.changeOrders).toBe(1_700)
    expect(report.totals.variances).toBe(0)
    expect(report.totals.adjustedEstimate).toBe(101_700)
    expect(report.totals.balance).toBe(66_700)
  })

  it("prints a line credited back this period with a negative current amount", () => {
    const credited = [
      { ...base, costCode: "03 31 00", description: "Structural Concrete", assemblyKey: null, assemblyName: null, assemblySort: 0, originalEstimate: 8_000, previousWorkCompleted: 6_000, currentWorkCompleted: -2_000 },
      { ...base, costCode: "03 21 00", description: "Reinforcing Steel", assemblyKey: null, assemblyName: null, assemblySort: 0, originalEstimate: 2_000, currentWorkCompleted: 500 },
    ]
    const report = payApplicationReport(credited, "cost_code")
    const concrete = report.groups.find((group) => group.key === "03 31 00")
    expect(concrete).toMatchObject({ priorCosts: 6_000, currentCosts: -2_000, completedToDate: 4_000, percentComplete: 50, balance: 4_000 })
    expect(report.totals).toMatchObject({ priorCosts: 6_000, currentCosts: -1_500, completedToDate: 4_500, percentComplete: 45, balance: 5_500 })
  })
})

describe("payApplicationReport G703 columns", () => {
  it("splits changes into running change-order and variance columns, with variances on their cost code row", () => {
    const rows = [
      // A $2,000 change order on its own row, and a $500 lumber increase on the framing line.
      { ...base, costCode: "06 10 00", description: "Rough Carpentry", divisionCode: "06", divisionName: "Wood", assemblyKey: null, assemblyName: null, assemblySort: 0, originalEstimate: 10_000, priorChanges: 300, currentChanges: 200, totalVariances: 500, currentWorkCompleted: 0 },
      { ...base, costCode: "07 10 00", description: "Waterproofing", divisionCode: "07", divisionName: "Thermal", assemblyKey: "co:1", assemblyName: "Change order CO-001", assemblySort: 500_000, originalEstimate: 0, priorChanges: 2_000, currentWorkCompleted: 0 },
    ]
    const report = payApplicationReport(rows, "cost_code")
    const framing = report.groups.find((group) => group.key === "06 10 00")
    expect(framing).toMatchObject({ originalContractSum: 10_000, changeOrders: 0, variances: 500, adjustedEstimate: 10_500 })
    expect(report.totals).toMatchObject({ originalContractSum: 10_000, changeOrders: 2_000, variances: 500, adjustedEstimate: 12_500 })
  })
})

describe("payApplicationChangeSummary", () => {
  it("names this period's change orders", () => {
    const summary = payApplicationChangeSummary(sources)
    expect(summary.changeOrders).toMatchObject({
      previous: { additions: 0, deductions: 0 },
      current: { additions: 1_700, deductions: 0 },
      net: 1_700,
      currentItems: [{ name: "Change order CO-001", amount: 1_700, assemblies: [] }],
    })
    expect(summary.variances.net).toBe(0)
  })

  it("names change orders that landed inside an assembly from the change-order list", () => {
    const list = [
      { name: "CO-000 · Earlier", amount: 400, current: false, assemblies: [], recordType: "change_order" as const },
      { name: "CO-001 · Plan revisions", amount: 1_700, current: true, assemblies: [{ name: "Kitchen", amount: 2_000 }, { name: "Framing", amount: -300 }], recordType: "change_order" as const },
    ]
    const withPrior = sources.map((source, index) => (index === 0 ? { ...source, priorChanges: 400 } : source))
    expect(payApplicationChangeSummary(withPrior, list).changeOrders.currentItems).toEqual([
      { name: "CO-001 · Plan revisions", amount: 1_700, assemblies: [{ name: "Kitchen", amount: 2_000 }, { name: "Framing", amount: -300 }] },
    ])
    // A list that doesn't add up to the line keeps its records and shows the difference.
    const short = payApplicationChangeSummary(sources, [{ ...list[1], amount: 99, assemblies: [] }])
    expect(short.changeOrders.currentItems).toEqual([{ name: "CO-001 · Plan revisions", amount: 99, assemblies: [] }])
    expect(short.changeOrders).toMatchObject({ reconciling: 1_601, totals: { additions: 1_700, deductions: 0 }, net: 1_700 })
  })

  it("splits G702 line 2 into change orders (additions/deductions) and variances (increases/decreases)", () => {
    const rows = [{ ...sources[0], priorChanges: 1_500, currentChanges: 650 }]
    const list = [
      { name: "CO-001", amount: 2_000, current: false, assemblies: [], recordType: "change_order" as const },
      { name: "V-001 · Lumber up", amount: 800, current: false, assemblies: [], recordType: "variance" as const },
      { name: "V-002 · Steel down", amount: -1_300, current: false, assemblies: [], recordType: "variance" as const },
      { name: "CO-002 · Deduct", amount: -250, current: true, assemblies: [], recordType: "change_order" as const },
      { name: "V-003 · Concrete up", amount: 900, current: true, assemblies: [], recordType: "variance" as const },
    ]
    const summary = payApplicationChangeSummary(rows, list)
    expect(summary.changeOrders).toMatchObject({
      previous: { additions: 2_000, deductions: 0 },
      current: { additions: 0, deductions: 250 },
      totals: { additions: 2_000, deductions: 250 },
      net: 1_750,
    })
    expect(summary.variances).toMatchObject({
      previous: { additions: 800, deductions: 1_300 },
      current: { additions: 900, deductions: 0 },
      net: 400,
    })
    // Line 3 = 1 + 2a + 2b.
    const original = 100_000
    expect(original + summary.changeOrders.net + summary.variances.net).toBe(original + 1_500 + 650)
  })
})

describe("payApplicationChangeSummary after imported draws", () => {
  // Application 9 after eight spreadsheet draws: the prior draw's rows carry
  // lumped, approximate changes, so per-row prior/current deltas are noise.
  const lumped = [
    { ...base, costCode: "06 10 00", description: "Rough Carpentry", divisionCode: "06", divisionName: "Wood", assemblyKey: "co:4", assemblyName: "Change order CO-004", assemblySort: 500_000, originalEstimate: 0, priorChanges: 4_043.48, currentChanges: 56.52, currentWorkCompleted: 0 },
    { ...base, costCode: "09 90 00", description: "Painting", divisionCode: "09", divisionName: "Finishes", assemblyKey: "co:5", assemblyName: "Change order CO-005", assemblySort: 500_001, originalEstimate: 0, priorChanges: 1_100, currentChanges: -100, currentWorkCompleted: 0 },
    { ...base, costCode: "07 10 00", description: "Waterproofing", divisionCode: "07", divisionName: "Thermal", assemblyKey: null, assemblyName: null, assemblySort: 0, originalEstimate: 20_000, priorChanges: 0, currentChanges: 1_243.48, totalVariances: 1_200, currentWorkCompleted: 0 },
  ]
  const list = [
    { name: "CO-004 · Deck stairs", amount: 4_100, current: false, assemblies: [], recordType: "change_order" as const },
    { name: "CO-005 · Paint credit", amount: 1_000, current: false, assemblies: [], recordType: "change_order" as const },
    { name: "CO-006 · Added outlet", amount: 43.48, current: true, assemblies: [], recordType: "change_order" as const },
    { name: "V-001 · Membrane price up", amount: 1_500, current: false, assemblies: [], recordType: "variance" as const },
    { name: "V-002 · Membrane credit", amount: -300, current: true, assemblies: [], recordType: "variance" as const },
  ]
  const netChanges = 4_100 + 1_000 + 43.48 + 1_500 - 300

  it("ties change orders to line 2a and variances to line 2b by execution date", () => {
    const summary = payApplicationChangeSummary(lumped, list, netChanges)
    expect(summary.changeOrders).toMatchObject({
      previous: { additions: 5_100, deductions: 0 },
      current: { additions: 43.48, deductions: 0 },
      reconciling: 0,
      totals: { additions: 5_143.48, deductions: 0 },
      net: 5_143.48,
      currentItems: [{ name: "CO-006 · Added outlet", amount: 43.48, assemblies: [] }],
    })
    expect(summary.variances).toMatchObject({
      previous: { additions: 1_500, deductions: 0 },
      current: { additions: 0, deductions: 300 },
      reconciling: 0,
      net: 1_200,
      currentItems: [{ name: "V-002 · Membrane credit", amount: -300, assemblies: [] }],
    })
  })

  it("counts a record by its own total and shows a reconciling line to keep the line tied", () => {
    // CO-006 adds a $5 builder fee line that didn't land in this budget revision.
    const withFee = list.map((item) => (item.name.startsWith("CO-006") ? { ...item, headerAmount: 48.48 } : item))
    const summary = payApplicationChangeSummary(lumped, withFee, netChanges)
    expect(summary.changeOrders).toMatchObject({
      current: { additions: 48.48, deductions: 0 },
      reconciling: -5,
      totals: { additions: 5_148.48, deductions: 5 },
      net: 5_143.48,
    })
  })
})
