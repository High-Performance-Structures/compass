import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ProjectEstimateReportPhases } from "@/components/projects/project-estimate-report-phases"
import { clientEstimatePhases, estimateClientReportMode, type ClientEstimateLine } from "@/lib/estimates/client-report"

function line(id: string, reportPhaseId: string | null): ClientEstimateLine {
  return { id, reportPhaseId, divisionCode: "03", divisionName: "Concrete", costCode: "03 11 19", costCodeName: "Concrete forming", description: `${id} assembly`, specifications: null, quantity: 1, unit: "LS", unitCostCents: 12345, taxCode: null, taxName: null, taxRateBasisPoints: 0, taxCents: 0, lineTotalCents: 12345, ownerVisible: true, includeInBuilderFee: true, sortOrder: 1, costItems: [{ id: `${id}-detail`, costCode: "03 20 00", costCodeName: "Rebar", description: `${id} detailed scope`, quantity: 1, unit: "LS", unitCostCents: 12345, taxCode: null, taxName: null, taxRateBasisPoints: 0, taxCents: 0, lineTotalCents: 12345 }] }
}

describe("mixed-detail customer estimate report", () => {
  it("retains compact default reporting without exposing new assembly detail", () => {
    for (const department of ["H", "O", "N", "D"] as const) {
      const reportMode = estimateClientReportMode(department)
      const phases = clientEstimatePhases({ phaseDescriptions: { "03": "Concrete structure" }, defaultItemize: reportMode === "line_items", lines: [line("forms", null)] })
      const html = renderToStaticMarkup(createElement(ProjectEstimateReportPhases, { phases, reportMode }))
      expect(html).toContain("$123.45")
      expect(html).not.toContain("forms detailed scope")
      expect(html).not.toContain("Source CSI division")
      if (reportMode === "line_items") expect(html).toContain("Total: 03 · Concrete structure")
      else expect(html).toContain("Subtotal")
    }
  })

  it("works in every department and never exposes lump-sum line detail", () => {
    for (const department of ["H", "O", "N", "D"] as const) {
      const reportMode = estimateClientReportMode(department)
      const phases = clientEstimatePhases({ phaseDescriptions: {}, defaultItemize: reportMode === "line_items", reportPhases: [
        { id: "fox", divisionCode: "03", name: "Fox Blocks", description: "ICF wall scope", itemize: true, sortOrder: 1 },
        { id: "concrete", divisionCode: "03", name: "Structural concrete", description: "Footings and slabs", itemize: false, sortOrder: 2 },
      ], lines: [line("forms", "fox"), line("slabs", "concrete"), { ...line("private", "fox"), ownerVisible: false }] })
      const html = renderToStaticMarkup(createElement(ProjectEstimateReportPhases, { phases, reportMode }))
      expect(html).toContain("Fox Blocks")
      expect(html).toContain("ICF wall scope")
      expect(html).toContain("forms detailed scope")
      expect(html).toContain("Assembly subtotal: forms assembly")
      expect(html).toContain("Total: Fox Blocks")
      expect(html).toContain("Structural concrete")
      expect(html).not.toContain("slabs assembly")
      expect(html).not.toContain("slabs detailed scope")
      expect(html).not.toContain("private")
      expect(phases.reduce((sum, phase) => sum + phase.subtotalCents, 0)).toBe(24690)
    }
  })
})
