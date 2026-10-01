import { describe, expect, it } from "vitest"
import { groupEstimateAssemblies } from "@/lib/estimates/assemblies"
import { clientEstimateReportGroups, isEstimateClientReportMode } from "@/lib/estimates/client-report"

const assemblies = [
  { id: "foundation", name: "Foundation package", description: "Complete foundation", sortOrder: 0 },
  { id: "slab", name: "Slab package", description: null, sortOrder: 1 },
  { id: "empty", name: "Future work", description: null, sortOrder: 2 },
]
const lines = [
  { id: "excavation", assemblyId: "foundation", divisionCode: "31", divisionName: "Earthwork", costCode: "31-100", lineTotalCents: 1200000, ownerVisible: true },
  { id: "footings", assemblyId: "foundation", divisionCode: "03", divisionName: "Concrete", costCode: "03-100", lineTotalCents: 1800000, ownerVisible: true },
  { id: "slab", assemblyId: "slab", divisionCode: "03", divisionName: "Concrete", costCode: "03-200", lineTotalCents: 2500000, ownerVisible: true },
  { id: "mobilization", assemblyId: null, divisionCode: "01", divisionName: "General requirements", costCode: "01-100", lineTotalCents: 500000, ownerVisible: true },
  { id: "internal", assemblyId: "foundation", divisionCode: "03", divisionName: "Concrete", costCode: "03-300", lineTotalCents: 9900000, ownerVisible: false },
].map((line, sortOrder) => ({ ...line, reportPhaseId: null, costCodeName: line.costCode, taxCode: null, taxName: null, taxRateBasisPoints: 0, taxCents: 0, costItems: [], description: line.id, specifications: null, quantity: 1, unit: "LS", unitCostCents: line.lineTotalCents, includeInBuilderFee: true, sortOrder }))

describe("estimate assemblies", () => {
  it("shows cross-division subtotals, empty assemblies and unassigned work in the editor", () => {
    const groups = groupEstimateAssemblies(assemblies, lines)
    expect(groups.map((group) => [group.name, group.subtotalCents])).toEqual([
      ["Foundation package", 12900000], ["Slab package", 2500000], ["Future work", 0], ["Other work", 500000],
    ])
    expect(groups[0]?.lines.map((line) => line.costCode)).toEqual(["31-100", "03-100", "03-300"])
    expect(groups.flatMap((group) => group.lines)).toHaveLength(lines.length)
  })

  it("keeps orphaned assignments visible under Other work", () => {
    const groups = groupEstimateAssemblies([], lines)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.lines).toHaveLength(lines.length)
  })

  it("preserves all existing report choices and adds both assembly formats", () => {
    for (const mode of ["division_summary", "phase_summary", "line_items", "assembly_summary", "assembly_items"]) expect(isEstimateClientReportMode(mode)).toBe(true)
    expect(isEstimateClientReportMode("unknown")).toBe(false)
  })

  it("reconciles every report mode without exposing internal items", () => {
    const phaseDescriptions = { "03": "Custom concrete scope" }
    for (const mode of ["division_summary", "phase_summary", "line_items", "assembly_summary", "assembly_items"] as const) {
      const groups = clientEstimateReportGroups({ mode, assemblies, lines, phaseDescriptions })
      expect(groups.reduce((sum, group) => sum + group.subtotalCents, 0)).toBe(6000000)
      expect(groups.flatMap((group) => group.lines).map((line) => line.id)).not.toContain("internal")
      expect(groups.flatMap((group) => group.lines)).toHaveLength(4)
      if (mode === "assembly_summary" || mode === "assembly_items") {
        expect(groups.map((group) => [group.name, group.subtotalCents])).toEqual([
          ["Foundation package", 3000000], ["Slab package", 2500000], ["Other work", 500000],
        ])
      } else {
        expect(groups.find((group) => group.divisionCode === "03")?.description).toBe("Custom concrete scope")
      }
    }
  })
})
