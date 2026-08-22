import { describe, expect, it } from "vitest"

import { projectEstimateCostCodeCatalog } from "@/lib/estimates/project-cost-code-catalog"

describe("project estimate cost-code catalog", () => {
  it("derives Division 01 codes from Sage item names", () => {
    const catalog = projectEstimateCostCodeCatalog([], [
      {
        sourceSystem: "sage_read_snapshot",
        costCode: "1711300.000",
        description: "01 71 13 - Mobilization",
        divisionName: "General Requirements",
      },
      {
        sourceSystem: "sage_read_snapshot",
        costCode: "1732300.000",
        description: "01 73 23 - Bracing & Anchoring",
        divisionName: "General Requirements",
      },
    ])

    expect(catalog.filter((item) => item.sageMapped)).toEqual([
      expect.objectContaining({
        code: "01 71 13",
        sourceCostCode: "1711300.000",
        description: "Mobilization",
        divisionCode: "01",
        divisionDescription: "General Requirements",
      }),
      expect.objectContaining({
        code: "01 73 23",
        sourceCostCode: "1732300.000",
        description: "Bracing & Anchoring",
      }),
    ])
  })

  it("keeps the primary Sage catalog authoritative for duplicate codes", () => {
    const catalog = projectEstimateCostCodeCatalog(
      [
        {
          code: "03 31 00",
          description: "Sage concrete",
          displayLabel: "03 31 00 Sage concrete",
          divisionCode: "03",
          divisionDescription: "Concrete",
          divisionDisplayLabel: "03 · Concrete",
        },
      ],
      [
        {
          sourceSystem: "sage_read_snapshot",
          costCode: "3310000.000",
          description: "03 31 00 - Project concrete",
          divisionName: "Concrete",
        },
      ]
    )

    const mapped = catalog.filter((item) => item.sageMapped)
    expect(mapped).toHaveLength(1)
    expect(mapped[0]).toMatchObject({
      description: "Sage concrete",
      sourceCostCode: "03 31 00",
    })
  })

  it("ignores non-Sage rows and names without a CSI code", () => {
    const catalog = projectEstimateCostCodeCatalog([], [
      {
        sourceSystem: "google_drive_g703",
        costCode: "01 71 13",
        description: "01 71 13 - Mobilization",
        divisionName: "General Requirements",
      },
      {
        sourceSystem: "sage_read_snapshot",
        costCode: "1711300.000",
        description: "Mobilization",
        divisionName: "General Requirements",
      },
    ])

    expect(catalog.filter((item) => item.sageMapped)).toEqual([])
  })

  it("deduplicates the same named Sage item across project snapshots", () => {
    const row = {
      sourceSystem: "sage_read_snapshot",
      costCode: "1711300.000",
      description: "01 71 13 - Mobilization",
      divisionName: "General Requirements",
    }

    expect(
      projectEstimateCostCodeCatalog([], [row, row]).filter(
        (item) => item.sageMapped
      )
    ).toHaveLength(1)
  })

  it("retains verified CSI-only choices and flags them as unmapped", () => {
    const catalog = projectEstimateCostCodeCatalog([], [])

    expect(catalog.find((item) => item.code === "01 00 00")).toMatchObject({
      divisionCode: "01",
      sageMapped: false,
    })
    expect(catalog.find((item) => item.code === "48 14 00")).toMatchObject({
      divisionCode: "48",
      sageMapped: false,
    })
    expect(catalog.some((item) => item.code === "33 12 16")).toBe(false)
  })
})
