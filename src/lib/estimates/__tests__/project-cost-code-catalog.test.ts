import { describe, expect, it } from "vitest"

import { projectEstimateCostCodeCatalog } from "@/lib/estimates/project-cost-code-catalog"

describe("project estimate cost-code catalog", () => {
  it("includes the complete workbook catalog with named Sage choices", () => {
    const catalog = projectEstimateCostCodeCatalog([], [])

    expect(catalog.length).toBeGreaterThanOrEqual(1_169)
    expect(catalog.find((item) => item.code === "01 31 00")).toMatchObject({
      divisionCode: "01",
      divisionDescription: "General Requirements",
      sageMapped: true,
    })
    expect(catalog.find((item) => item.code === "Company Margin")).toMatchObject({
      description: "Company Margin",
      divisionCode: "00",
      divisionDescription: "Procurement Requirements",
      sageMapped: true,
    })
    expect(
      catalog.find((item) => item.code === "Company Overhead")
    ).toMatchObject({ sageMapped: true })
    expect(
      catalog.find((item) => item.code === "Contingency Reserve")
    ).toMatchObject({ sageMapped: true })
  })

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
    ], [])

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
          sourceSystem: "sage_xlsx",
          sourceRecordId: null,
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
      ],
      []
    )

    const mapped = catalog.filter((item) => item.sageMapped)
    expect(mapped).toHaveLength(1)
    // The Sage catalog keeps its name; Sage's job data supplies the record number.
    expect(mapped[0]).toMatchObject({
      description: "Sage concrete",
      sourceCostCode: "3310000",
    })
  })

  it("gives workbook codes and builder fees the record number Sage files them under", () => {
    const row = (costCode: string, description: string) => ({ sourceSystem: "sage_read_snapshot", costCode, description, divisionName: "Concrete" })
    const catalog = projectEstimateCostCodeCatalog([], [
      row("3111900.000", "03 11 19 - Insulating Concrete Forming"),
      row("35.000", "Contingency"),
      row("34.000", "Company Overhead"),
      // Two records for one code: ambiguous, so neither is used.
      row("3300100.000", "03 30 01 - Concrete A"),
      row("3300199.000", "03 30 01 - Concrete B"),
    ], [
      ["03 11 19 - Insulating Concrete Forming", "", "03", "Concrete"],
      ["03 30 01 - Concrete", "", "03", "Concrete"],
      ["Company Overhead", "", "00", "Procurement Requirements"],
      ["Contingency Reserve", "", "00", "Procurement Requirements"],
    ])

    expect(catalog.find((item) => item.code === "03 11 19")?.sourceCostCode).toBe("3111900")
    expect(catalog.find((item) => item.code === "Company Overhead")?.sourceCostCode).toBe("34")
    expect(catalog.find((item) => item.code === "Contingency Reserve")?.sourceCostCode).toBe("35")
    expect(catalog.find((item) => item.code === "03 30 01")?.sourceCostCode).toBe("03 30 01 - Concrete")
  })

  it("replaces a workbook name match with its active Sage item ID", () => {
    const catalog = projectEstimateCostCodeCatalog([
      {
        sourceSystem: "sage_xlsx",
        sourceRecordId: null,
        code: "1000034",
        description: "Company Overhead",
        displayLabel: "1000034 Company Overhead",
        divisionCode: "00",
        divisionDescription: "Procurement Requirements",
        divisionDisplayLabel: "00 · Procurement Requirements",
      },
    ], [])

    expect(catalog.some((item) => item.code === "Company Overhead")).toBe(false)
    expect(catalog.find((item) => item.code === "1000034")).toMatchObject({
      description: "Company Overhead",
      sourceCostCode: "1000034",
      sageMapped: true,
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
    ], [])

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
      projectEstimateCostCodeCatalog([], [row, row], []).filter(
        (item) => item.sageMapped
      )
    ).toHaveLength(1)
  })

  it("retains verified CSI-only choices and flags them as unmapped", () => {
    const catalog = projectEstimateCostCodeCatalog([], [], [])

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
