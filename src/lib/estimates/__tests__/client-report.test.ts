import { describe, expect, it } from "vitest"

import {
  builtInEstimateTextTemplates,
  clientEstimateBuilderFeeExclusionSummary,
  clientEstimatePhases,
  clientEstimateTaxSummary,
  defaultEstimateTitle,
  estimateClientReportMode,
  mergeEstimateTextTemplates,
  estimateTitleForDepartment,
  type ClientEstimateLine,
} from "@/lib/estimates/client-report"

function line(
  overrides: Partial<ClientEstimateLine> = {}
): ClientEstimateLine {
  return {
    id: "line-1",
    reportPhaseId: null,
    divisionCode: "03",
    divisionName: "Concrete",
    costCode: "03 30 00",
    costCodeName: "Cast-in-Place Concrete",
    description: "Cast-in-place concrete",
    specifications: null,
    quantity: 2,
    unit: "CY",
    unitCostCents: 5_000,
    taxCode: null,
    taxName: null,
    taxRateBasisPoints: 0,
    taxCents: 0,
    lineTotalCents: 10_000,
    ownerVisible: true,
    includeInBuilderFee: true,
    sortOrder: 0,
    costItems: [],
    ...overrides,
  }
}

describe("estimate client report profiles", () => {
  it("splits one CSI division into unlimited named phases with independent detail", () => {
    const reportPhases = [
      { id: "fox", divisionCode: "03", name: "Fox Blocks", description: "ICF walls", itemize: true, sortOrder: 1 },
      { id: "concrete", divisionCode: "03", name: "Structural concrete", description: "Footings and slabs", itemize: false, sortOrder: 2 },
      { id: "rebar", divisionCode: "03", name: "Reinforcing steel", description: "Supply and install", itemize: false, sortOrder: 3 },
      { id: "empty", divisionCode: "03", name: "Future work", description: "", itemize: true, sortOrder: 4 },
    ]
    const phases = clientEstimatePhases({
      reportPhases, defaultItemize: true, phaseDescriptions: {},
      lines: [
        line({ id: "steel", reportPhaseId: "rebar", lineTotalCents: 300 }),
        line({ id: "forms", reportPhaseId: "fox", lineTotalCents: 100 }),
        line({ id: "slab", reportPhaseId: "concrete", lineTotalCents: 200 }),
        line({ id: "unassigned", lineTotalCents: 400 }),
        line({ id: "hidden", reportPhaseId: "fox", ownerVisible: false, lineTotalCents: 999 }),
      ],
    })
    expect(phases.map((phase) => [phase.name, phase.description, phase.itemize, phase.subtotalCents])).toEqual([
      ["Fox Blocks", "ICF walls", true, 100],
      ["Structural concrete", "Footings and slabs", false, 200],
      ["Reinforcing steel", "Supply and install", false, 300],
      ["Concrete", "Concrete", true, 400],
    ])
    expect(phases.reduce((sum, phase) => sum + phase.subtotalCents, 0)).toBe(1_000)
    expect(phases.every((phase) => phase.divisionCode === "03")).toBe(true)
  })

  it("returns missing or mismatched phase assignments to CSI without dropping costs", () => {
    const phases = clientEstimatePhases({
      phaseDescriptions: {},
      reportPhases: [{ id: "wrong", divisionCode: "04", name: "Masonry", description: "", itemize: true, sortOrder: 1 }],
      lines: [line({ reportPhaseId: "missing" }), line({ id: "line-2", reportPhaseId: "wrong" })],
    })
    expect(phases).toHaveLength(1)
    expect(phases[0]).toMatchObject({ id: "division:03", custom: false, itemize: false, subtotalCents: 20_000 })
  })

  it("preserves CSI division order with custom phases before each division's unassigned lines", () => {
    const phases = clientEstimatePhases({
      phaseDescriptions: {}, reportPhases: [{ id: "fox", divisionCode: "03", name: "Fox Blocks", description: "", itemize: true, sortOrder: 1 }],
      lines: [line({ id: "default-03" }), line({ id: "fox-line", reportPhaseId: "fox" }), line({ id: "general", divisionCode: "01", divisionName: "General requirements" }), line({ id: "masonry", divisionCode: "04", divisionName: "Masonry" })],
    })
    expect(phases.map((phase) => phase.id)).toEqual(["division:01", "fox", "division:03", "division:04"])
  })

  it("supports more phases than the database statement parameter budget", () => {
    const reportPhases = Array.from({ length: 150 }, (_, index) => ({ id: `phase-${index}`, divisionCode: "03", name: `Phase ${index}`, description: "", itemize: index % 2 === 0, sortOrder: index + 1 }))
    const phases = clientEstimatePhases({ phaseDescriptions: {}, reportPhases, lines: reportPhases.map((phase) => line({ id: phase.id, reportPhaseId: phase.id })) })
    expect(phases).toHaveLength(150)
    expect(phases.reduce((sum, phase) => sum + phase.subtotalCents, 0)).toBe(1_500_000)
  })

  it("totals the visible line amounts excluded from builder fees", () => {
    const summary = clientEstimateBuilderFeeExclusionSummary([
      line({
        id: "excluded-1",
        includeInBuilderFee: false,
        lineTotalCents: 12_345,
      }),
      line({
        id: "included",
        includeInBuilderFee: true,
        lineTotalCents: 99_999,
      }),
      line({
        id: "excluded-2",
        includeInBuilderFee: false,
        lineTotalCents: 7_655,
      }),
    ])

    expect(summary.lines.map((item) => item.id)).toEqual([
      "excluded-1",
      "excluded-2",
    ])
    expect(summary.totalCents).toBe(20_000)
  })

  it("selects the department-specific client detail level", () => {
    expect(estimateClientReportMode("H")).toBe("phase_summary")
    expect(estimateClientReportMode("O")).toBe("line_items")
    expect(estimateClientReportMode("N")).toBe("line_items")
    expect(estimateClientReportMode("D")).toBe("division_summary")
  })

  it("does not label H or N estimates as CA22 by default", () => {
    expect(defaultEstimateTitle("H")).toBe("Construction Estimate")
    expect(defaultEstimateTitle("N")).toBe("Material Estimate")
    expect(defaultEstimateTitle("O")).toBe("CA22 Construction Estimate")
    expect(
      estimateTitleForDepartment({
        department: "H",
        requestedTitle: "CA22 Construction Estimate",
      })
    ).toBe("Construction Estimate")
    expect(
      estimateTitleForDepartment({
        department: "H",
        requestedTitle: "Foundation and Shell Proposal",
      })
    ).toBe("Foundation and Shell Proposal")
  })

  it("uses editable phase descriptions and excludes internal-only lines", () => {
    const phases = clientEstimatePhases({
      lines: [
        line(),
        line({
          id: "line-2",
          costCode: "03 40 00",
          description: "Precast concrete",
          lineTotalCents: 5_000,
          sortOrder: 1,
        }),
        line({
          id: "line-private",
          ownerVisible: false,
          lineTotalCents: 99_000,
        }),
      ],
      phaseDescriptions: {
        "03": "Concrete foundations and structural slabs",
      },
    })

    expect(phases).toHaveLength(1)
    expect(phases[0]).toMatchObject({
      divisionCode: "03",
      description: "Concrete foundations and structural slabs",
      subtotalCents: 15_000,
      taxCents: 0,
    })
    expect(phases[0]?.lines.map((item) => item.id)).toEqual([
      "line-1",
      "line-2",
    ])
  })

  it("groups visible sales tax by the underlying tax entity", () => {
    const phases = clientEstimatePhases({
      lines: [
        line({
          id: "simple-tax",
          taxCode: "DENVER",
          taxName: "Denver",
          taxRateBasisPoints: 881,
          taxCents: 881,
          lineTotalCents: 10_881,
        }),
        line({
          id: "breakdown-tax",
          taxCents: 1_281,
          lineTotalCents: 16_281,
          costItems: [
            {
              taxCode: "DENVER",
              id: "breakdown-1", costCode: "03 11 13", costCodeName: "Forming", description: "Forming", quantity: 1, unit: "LS", unitCostCents: 10_000,
              taxName: "Denver",
              taxRateBasisPoints: 881,
              taxCents: 881,
              lineTotalCents: 10_881,
            },
            {
              taxCode: "CO",
              id: "breakdown-2", costCode: "03 20 00", costCodeName: "Rebar", description: "Rebar", quantity: 1, unit: "LS", unitCostCents: 5_000,
              taxName: "Colorado",
              taxRateBasisPoints: 400,
              taxCents: 400,
              lineTotalCents: 5_400,
            },
          ],
        }),
        line({
          id: "private-tax",
          ownerVisible: false,
          taxName: "Denver",
          taxRateBasisPoints: 881,
          taxCents: 8_810,
          lineTotalCents: 108_810,
        }),
      ],
      phaseDescriptions: {},
    })

    expect(phases[0]?.taxCents).toBe(2_162)
    expect(
      clientEstimateTaxSummary(phases.flatMap((phase) => phase.lines))
    ).toEqual({
      taxCents: 2_162,
      groups: [
        {
          key: "Colorado:400",
          label: "Colorado",
          rateBasisPoints: 400,
          taxableSubtotalCents: 5_000,
          taxCents: 400,
        },
        {
          key: "Denver:881",
          label: "Denver",
          rateBasisPoints: 881,
          taxableSubtotalCents: 20_000,
          taxCents: 1_762,
        },
      ],
    })
  })

  it("offers the Drive-sourced acknowledgement forms only to Nu-Tech", () => {
    const nutech = builtInEstimateTextTemplates({
      department: "N",
      templateType: "acknowledgement",
    })
    expect(nutech.map((template) => template.name)).toEqual([
      "Takeoff Acknowledgement",
      "Consultation and Indemnification Agreement",
    ])
    expect(nutech.every((template) => template.sourceUrl !== null)).toBe(true)
    expect(
      builtInEstimateTextTemplates({
        department: "H",
        templateType: "acknowledgement",
      })
    ).toEqual([])
  })

  it("offers the default introduction to every department", () => {
    for (const department of ["H", "O", "N", "D"] as const) {
      const templates = builtInEstimateTextTemplates({
        department,
        templateType: "introduction",
      })
      expect(templates).toHaveLength(1)
      expect(templates[0]?.name).toBe("Default Introductory Text")
      expect(templates[0]?.body).toContain(
        "Thank you for the opportunity to provide you with an estimate"
      )
    }
  })

  it("limits the HPS closing text to H and O estimates", () => {
    for (const department of ["H", "O"] as const) {
      const templates = builtInEstimateTextTemplates({
        department,
        templateType: "closing",
      })
      expect(templates).toHaveLength(1)
      expect(templates[0]?.body).toContain("General Exclusions:")
      expect(templates[0]?.body).toContain("Payment Terms:")
    }
    expect(
      builtInEstimateTextTemplates({
        department: "N",
        templateType: "closing",
      })
    ).toEqual([])
  })

  it("lets an organization template override matching built-in copy", () => {
    const builtIns = builtInEstimateTextTemplates({ department: "H" })
    const defaultIntroduction = builtIns.find(
      (template) => template.name === "Default Introductory Text"
    )
    expect(defaultIntroduction).toBeDefined()
    if (!defaultIntroduction) return

    const templates = mergeEstimateTextTemplates({
      organizationTemplates: [
        {
          ...defaultIntroduction,
          id: "organization-introduction",
          body: "Our organization-wide revised introduction.",
        },
      ],
      builtInTemplates: builtIns,
    })

    expect(
      templates.filter(
        (template) => template.name === "Default Introductory Text"
      )
    ).toEqual([
      expect.objectContaining({
        id: "organization-introduction",
        body: "Our organization-wide revised introduction.",
      }),
    ])
  })
})
