import { describe, expect, it } from "vitest"

import {
  isBudgetProjection,
  latestProgressApplication,
  withPayApplicationProgress,
  type ProgressLine,
} from "@/lib/financials/budget-progress-overlay"

// Fictional job: pay application 3 was built on revision 2; the budget is now on revision 4.
const applications = [
  { id: "budget-rev-4", sourceSystem: "compass_contract_budget_projection", status: "budget_current" },
  { id: "sage-read", sourceSystem: "sage_read_snapshot", status: "imported" },
  { id: "app-4-void", sourceSystem: "compass_contract_budget", status: "void" },
  { id: "app-3", sourceSystem: "compass_contract_budget", status: "billed" },
  { id: "budget-rev-2", sourceSystem: "compass_contract_budget_projection", status: "budget_superseded" },
  { id: "app-2", sourceSystem: "google_drive_g702_g703", status: "imported" },
] as const

function budgetLine(costCode: string, adjustedEstimate: number, id = costCode) {
  return {
    id,
    costCode,
    adjustedEstimate,
    priorCosts: 0,
    currentCosts: 0,
    totalCosts: 0,
    percentComplete: 0,
    balanceToFinish: adjustedEstimate,
    retainageHeld: 0,
  }
}

function progress(costCode: string, totalCosts: number, assemblyKey: string | null = null): ProgressLine {
  return { costCode, assemblyKey, priorCosts: totalCosts / 2, currentCosts: totalCosts / 2, totalCosts, retainageHeld: totalCosts / 10 }
}

describe("budget view progress", () => {
  it("takes the latest non-void pay application from any revision", () => {
    expect(isBudgetProjection(applications[0])).toBe(true)
    expect(latestProgressApplication(applications)?.id).toBe("app-3")
    expect(latestProgressApplication(applications.filter((row) => row.id !== "app-3"))?.id).toBe("app-2")
    expect(latestProgressApplication([applications[0]])).toBeNull()
  })

  it("shows a pay application on revision N against the budget on revision N+2", () => {
    const lines = withPayApplicationProgress(
      [budgetLine("06 10 00", 1000), budgetLine("Company Overhead", 200), budgetLine("09 91 00", 500)],
      // Imported draws carry the old Division 99 fee code.
      [progress("06 10 00", 250), progress("06 10 00", 150), progress("99 10 00", 50)]
    )
    expect(lines[0]).toMatchObject({ totalCosts: 400, priorCosts: 200, currentCosts: 200, retainageHeld: 40, percentComplete: 40, balanceToFinish: 600 })
    expect(lines[1]).toMatchObject({ totalCosts: 50, percentComplete: 25, balanceToFinish: 150 })
    expect(lines[2]).toMatchObject({ totalCosts: 0, percentComplete: 0, balanceToFinish: 500 })
  })

  it("maps by assembly where the assemblies line up, else spreads the cost code by budget", () => {
    const shares = [budgetLine("06 10 00", 600, "a"), budgetLine("06 10 00", 400, "b")]
    const keys: Record<string, string> = { a: "kitchen", b: "bath" }
    const byAssembly = withPayApplicationProgress(shares, [progress("06 10 00", 300, "bath")], (line) => keys[line.id] ?? null)
    expect(byAssembly.map((line) => line.totalCosts)).toEqual([0, 300])

    const spread = withPayApplicationProgress(shares, [progress("06 10 00", 500, "garage")], (line) => keys[line.id] ?? null)
    expect(spread.map((line) => line.totalCosts)).toEqual([300, 200])
    expect(spread.map((line) => line.percentComplete)).toEqual([50, 50])
  })
})
