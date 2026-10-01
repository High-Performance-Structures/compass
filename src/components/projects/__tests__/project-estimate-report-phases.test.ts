import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ProjectEstimateReportPhases } from "@/components/projects/project-estimate-report-phases"
import { clientEstimatePhases, clientEstimateReportGroups, estimateClientReportMode, type ClientEstimateLine } from "@/lib/estimates/client-report"

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
      const html = renderToStaticMarkup(createElement(ProjectEstimateReportPhases, { phases, reportMode, showCostBreakdowns: true }))
      expect(html).toContain("Fox Blocks")
      expect(html).toContain("ICF wall scope")
      expect(html).toContain("forms detailed scope")
      expect(html).toContain("Cost breakdown · included in the cost code amount above")
      expect(html).toContain("Total: Fox Blocks")
      expect(html).toContain("Structural concrete")
      expect(html).not.toContain("slabs assembly")
      expect(html).not.toContain("slabs detailed scope")
      expect(html).not.toContain("private")
      expect(phases.reduce((sum, phase) => sum + phase.subtotalCents, 0)).toBe(24690)
    }
  })
})


describe("optional assembly builder-fee presentation", () => {
  it("shows work, combined fee, and fee-inclusive totals in both assembly modes only", () => {
    for (const reportMode of ["assembly_summary", "assembly_items"] as const) {
      const phases = clientEstimateReportGroups({ mode: reportMode, assemblies: [{ id: "phase-a", name: "Foundation phase", description: "Foundation work", sortOrder: 0 }], lines: [{ ...line("forms", null), assemblyId: "phase-a" }], phaseDescriptions: {} })
      const assemblyBuilderFees = new Map([["phase-a", 2469]])
      const html = renderToStaticMarkup(createElement(ProjectEstimateReportPhases, { phases, reportMode, assemblyBuilderFees }))
      expect(html).toContain("Builder-fee subtotal")
      expect(html).toContain("Overhead, margin, and contingency")
      expect(html).toContain("$24.69")
      expect(html).toContain("$148.14")
      expect(html).toContain("Work subtotal")
      const disabled = renderToStaticMarkup(createElement(ProjectEstimateReportPhases, { phases, reportMode }))
      expect(disabled).not.toContain("Builder-fee subtotal")
      expect(disabled).not.toContain("$148.14")
    }
  })
  it("keeps the optional fee presentation out of division and custom phase reports", () => {
    const phases = clientEstimatePhases({ lines: [line("forms", null)], phaseDescriptions: {} })
    for (const reportMode of ["division_summary", "phase_summary", "line_items"] as const) {
      const html = renderToStaticMarkup(createElement(ProjectEstimateReportPhases, { phases, reportMode, assemblyBuilderFees: new Map([[phases[0]?.id ?? "", 2469]]) }))
      expect(html).not.toContain("Builder-fee subtotal")
      expect(html).not.toContain("$148.14")
    }
  })
})

describe("customer report readability and optional cost breakdowns", () => {
  it("keeps underlying costs hidden by default in both itemized report modes", () => {
    for (const reportMode of ["line_items", "assembly_items"] as const) {
      const phases = clientEstimateReportGroups({ mode: reportMode, assemblies: [{ id: "a", name: "Foundation phase", description: "Footings and walls", sortOrder: 0 }], lines: [{ ...line("forms", null), assemblyId: "a" }, { ...line("private", null), assemblyId: "a", ownerVisible: false }], phaseDescriptions: {}, defaultItemize: true })
      const hidden = renderToStaticMarkup(createElement(ProjectEstimateReportPhases, { phases, reportMode }))
      const shown = renderToStaticMarkup(createElement(ProjectEstimateReportPhases, { phases, reportMode, showCostBreakdowns: true }))
      expect(hidden).toContain("forms assembly")
      expect(hidden).not.toContain("forms detailed scope")
      expect(shown).toContain("forms detailed scope")
      expect(shown).toContain("included in the cost code amount above")
      expect(shown).not.toContain("private")
      expect(phases[0]?.subtotalCents).toBe(12345)
      expect(hidden).toContain("bg-report-total")
      expect(hidden).toContain("bg-report-heading")
      expect(hidden).toContain("pl-6")
      expect(shown).toContain("pl-10")
    }
  })
  it("shows saved descriptions and only totals in summary views even with breakdowns enabled", () => {
    for (const reportMode of ["division_summary", "assembly_summary"] as const) {
      const phases = clientEstimateReportGroups({ mode: reportMode, assemblies: [{ id: "a", name: "Foundation phase", description: "Complete foundation scope", sortOrder: 0 }], lines: [{ ...line("forms", null), assemblyId: "a" }], phaseDescriptions: { "03": "Concrete footings and foundation walls" } })
      const html = renderToStaticMarkup(createElement(ProjectEstimateReportPhases, { phases, reportMode, showCostBreakdowns: true }))
      expect(html).toContain(reportMode === "assembly_summary" ? "Complete foundation scope" : "Concrete footings and foundation walls")
      expect(html).not.toContain("forms assembly")
      expect(html).not.toContain("forms detailed scope")
      expect(html).not.toContain("<table")
      expect(html).toContain("$123.45")
    }
  })
  it("uses only visible parent scopes when a summary has no saved description", () => {
    for (const reportMode of ["division_summary", "assembly_summary"] as const) {
      const phases = clientEstimateReportGroups({ mode: reportMode, assemblies: [{ id: "a", name: "Foundation phase", description: "", sortOrder: 0 }], lines: [{ ...line("forms", null), assemblyId: "a" }, { ...line("private", null), assemblyId: "a", ownerVisible: false }], phaseDescriptions: {} })
      const html = renderToStaticMarkup(createElement(ProjectEstimateReportPhases, { phases, reportMode }))
      expect(html).toContain("forms assembly")
      expect(html).not.toContain("forms detailed scope")
      expect(html).not.toContain("private")
    }
  })
})
