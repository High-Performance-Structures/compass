import { describe, expect, it } from "vitest"

import type { ClientEstimateLine, ClientEstimatePhase } from "@/lib/estimates/client-report"
import { estimateReportSection, estimateReportSectionOptions } from "@/lib/estimates/report-sections"

function line(id: string, lineTotalCents: number, includeInBuilderFee = true): ClientEstimateLine {
  return {
    id, reportPhaseId: null, divisionCode: "03", divisionName: "Concrete", costCode: "03-100",
    costCodeName: "Footings", description: "Footings", specifications: null, quantity: 1, unit: "ls",
    unitCostCents: lineTotalCents, taxCode: null, taxName: null, taxRateBasisPoints: 0, taxCents: 0,
    lineTotalCents, ownerVisible: true, includeInBuilderFee, sortOrder: 0, costItems: [],
  }
}

function group(id: string, name: string, lines: readonly ClientEstimateLine[]): ClientEstimatePhase {
  return {
    id, name, custom: true, itemize: false, divisionCode: "", divisionName: name, description: "",
    subtotalCents: lines.reduce((sum, item) => sum + item.lineTotalCents, 0), taxCents: 0, lines,
  }
}

const foundation = group("assembly-1", "Foundation", [line("a", 60_000_00)])
const framing = group("assembly-2", "Framing", [line("b", 30_000_00), line("c", 10_000_00, false)])
const phases = [foundation, framing]
const lines = phases.flatMap((phase) => phase.lines)

describe("estimate report sections", () => {
  it("lists each assembly for the print picker", () => {
    expect(estimateReportSectionOptions(phases, "assembly_summary")).toEqual([
      { id: "assembly-1", label: "Assembly: Foundation" },
      { id: "assembly-2", label: "Assembly: Framing" },
    ])
  })

  it("prints one assembly with its share of the builder fee", () => {
    const section = estimateReportSection({
      phases, lines, mode: "assembly_items", builderFeeCents: 9_000_00, sectionId: "assembly-1",
    })
    expect(section?.phase.id).toBe("assembly-1")
    // 60k of the 90k fee base carries two thirds of the fee.
    expect(section?.builderFeeCents).toBe(6_000_00)
    expect(section?.totalCents).toBe(66_000_00)
  })

  it("keeps fee-excluded lines out of the fee share", () => {
    const section = estimateReportSection({
      phases, lines, mode: "assembly_items", builderFeeCents: 9_000_00, sectionId: "assembly-2",
    })
    expect(section?.subtotalCents).toBe(40_000_00)
    expect(section?.builderFeeCents).toBe(3_000_00)
  })

  it("prints the entire estimate without a known section", () => {
    for (const sectionId of [null, "missing"]) {
      expect(estimateReportSection({ phases, lines, mode: "division_summary", builderFeeCents: 0, sectionId })).toBeNull()
    }
  })
})
