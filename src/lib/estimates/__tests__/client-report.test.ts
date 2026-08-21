import { describe, expect, it } from "vitest"

import {
  builtInEstimateTextTemplates,
  clientEstimatePhases,
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
    divisionCode: "03",
    divisionName: "Concrete",
    costCode: "03 30 00",
    description: "Cast-in-place concrete",
    specifications: null,
    quantity: 2,
    unit: "CY",
    unitCostCents: 5_000,
    lineTotalCents: 10_000,
    ownerVisible: true,
    sortOrder: 0,
    ...overrides,
  }
}

describe("estimate client report profiles", () => {
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
    })
    expect(phases[0]?.lines.map((item) => item.id)).toEqual([
      "line-1",
      "line-2",
    ])
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
