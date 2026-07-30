import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import type {
  ProjectBudgetDivision,
  ProjectBudgetLineItem,
  ProjectBudgetSummary,
} from "@/app/actions/project-budget"
import {
  ProjectBudgetG703Table,
  ProjectBudgetPanel,
} from "@/components/projects/project-budget-panel"

function budgetLine(index: number): ProjectBudgetLineItem {
  const code = String(index).padStart(2, "0")
  return {
    id: `line-${index}`,
    sourceSystem: "test",
    costCode: `${code} 00 00`,
    csiDivision: code,
    csiDivisionName: `Division ${index + 1}`,
    description: `Division ${index + 1}`,
    notes: null,
    originalEstimate: 1_000,
    priorChanges: 50,
    currentChanges: 50,
    totalChanges: 100,
    adjustedEstimate: 1_100,
    priorCosts: 400,
    currentCosts: 100,
    totalCosts: 500,
    percentComplete: 45.5,
    balanceToFinish: 600,
    retainageHeld: 50,
    vendorName: null,
    ownerLabel: null,
    ownerVisible: true,
    internalNotes: null,
  }
}

function budgetDivision(
  line: ProjectBudgetLineItem
): ProjectBudgetDivision {
  return {
    csiDivision: line.csiDivision,
    csiDivisionName: line.csiDivisionName,
    originalEstimate: line.originalEstimate,
    totalChanges: line.totalChanges,
    adjustedEstimate: line.adjustedEstimate,
    priorCosts: line.priorCosts,
    totalCosts: line.totalCosts,
    currentCosts: line.currentCosts,
    retainageHeld: line.retainageHeld,
    balanceToFinish: line.balanceToFinish,
    percentComplete: line.percentComplete,
    lineCount: 1,
    lines: [line],
  }
}

function budgetSummary(): ProjectBudgetSummary {
  const lines = Array.from({ length: 7 }, (_, index) => budgetLine(index))
  return {
    audience: "owner",
    detailMode: "cost_code",
    applications: [],
    currentApplication: null,
    totals: {
      originalEstimate: 7_000,
      totalChanges: 700,
      adjustedEstimate: 7_700,
      priorCosts: 2_800,
      totalCosts: 3_500,
      currentCosts: 700,
      retainageHeld: 350,
      balanceToFinish: 4_200,
      percentComplete: 45.5,
      overBudgetAmount: 0,
      ownerVisibleLineCount: 7,
    },
    divisions: lines.map(budgetDivision),
    allLines: lines,
  }
}

describe("owner project budget", () => {
  it("shows every approved category when the dedicated view has no limit", () => {
    const html = renderToStaticMarkup(
      <ProjectBudgetPanel
        projectId="project-1"
        summary={budgetSummary()}
        detailHref={null}
        divisionLimit={null}
      />
    )

    expect(html).toContain("00 - Division 1")
    expect(html).toContain("06 - Division 7")
  })

  it("includes prior amounts and project totals in the G703", () => {
    const html = renderToStaticMarkup(
      <ProjectBudgetG703Table
        summary={budgetSummary()}
        showVisibility={false}
      />
    )

    expect(html).toContain("G703 project totals")
    expect(html).toContain("$2,800")
    expect(html).toContain("$7,700")
    expect(html).toContain("$4,200")
  })
})
