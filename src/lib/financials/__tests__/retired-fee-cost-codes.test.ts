import { describe, expect, it } from "vitest"

import {
  builderFeeCatalogRow,
  canonicalFeeCostCode,
  isLegacyFeeCostCode,
  missingBuilderFeeRows,
  resolveCatalogCostCode,
} from "@/lib/domain/financials/builder-fee-codes"
import { projectEstimateCostCodeCatalog } from "@/lib/estimates/project-cost-code-catalog"
import { parseProjectTotalsRows } from "@/lib/financials/project-totals-import"

const concrete = {
  code: "03 30 00",
  description: "Cast-in-Place Concrete",
  divisionCode: "03",
  divisionDescription: "Concrete",
}
const sageOverhead = {
  code: "34",
  description: "Company Overhead",
  divisionCode: "00",
  divisionDescription: "Procurement Requirements",
}

describe("retired 99 x0 00 fee codes", () => {
  it("recognizes only the legacy Division 99 codes", () => {
    expect(isLegacyFeeCostCode("99 10 00")).toBe(true)
    expect(isLegacyFeeCostCode(" 99  30 00")).toBe(true)
    expect(isLegacyFeeCostCode("Company Overhead")).toBe(false)
    expect(isLegacyFeeCostCode("99 40 00")).toBe(false)
  })

  it("still reads stored legacy rows as their canonical fee", () => {
    expect(canonicalFeeCostCode("99 20 00")).toBe("Company Margin")
  })

  it("files a fee under the Sage row named for it, else its name", () => {
    expect(builderFeeCatalogRow([concrete, sageOverhead], "99 10 00")).toEqual(sageOverhead)
    expect(builderFeeCatalogRow([concrete, sageOverhead], "Company Overhead")).toEqual(sageOverhead)
    expect(builderFeeCatalogRow([concrete], "99 30 00")).toEqual({
      code: "Contingency Reserve",
      description: "Contingency Reserve",
      divisionCode: "00",
      divisionDescription: "Procurement Requirements",
    })
    expect(builderFeeCatalogRow([concrete], "03 30 00")).toBeNull()
  })

  it("resolves an imported legacy fee code to the canonical catalog row", () => {
    const catalog = new Map([concrete, sageOverhead].map((row) => [row.code, row]))
    expect(resolveCatalogCostCode(catalog, "03 30 00")).toEqual(concrete)
    expect(resolveCatalogCostCode(catalog, "99 10 00")).toEqual(sageOverhead)
    expect(resolveCatalogCostCode(catalog, "99 20 00")?.code).toBe("Company Margin")
    expect(resolveCatalogCostCode(catalog, "04 20 00")).toBeNull()
  })

  it("adds a named fee choice only where the catalog lacks one", () => {
    expect(missingBuilderFeeRows([concrete, sageOverhead]).map((row) => row.code)).toEqual([
      "Company Margin",
      "Contingency Reserve",
    ])
  })

  it("never offers a 99 x0 00 code in the cost-code catalog", () => {
    const catalog = projectEstimateCostCodeCatalog(
      [
        {
          code: "99 10 00",
          description: "Legacy Overhead",
          displayLabel: "99 10 00 Legacy Overhead",
          divisionCode: "99",
          divisionDescription: "Contract Adjustments",
          divisionDisplayLabel: "99 · Contract Adjustments",
        },
      ],
      [
        {
          sourceSystem: "sage_read_snapshot",
          costCode: "991000.000",
          description: "99 20 00 - Company Margin",
          divisionName: "Contract Adjustments",
        },
      ]
    )
    expect(catalog.some((row) => isLegacyFeeCostCode(row.code))).toBe(false)
    expect(catalog.find((row) => row.code === "Company Overhead")).toBeDefined()
  })
})

describe("Project Totals sheets with legacy fee rows", () => {
  it("reads a coded fee row in the fee section as the builder fee", () => {
    const result = parseProjectTotalsRows([
      ["03 30 00 - Cast-in-Place Concrete", null, null, null, 1_000],
      ["Project Subtotal:", null, null, null, 1_000],
      ["Company Overhead & Margin"],
      ["99 10 00 - Company Overhead", null, null, null, 100],
      ["99 20 00 - Company Margin", null, null, null, 50],
      ["Project Total:", null, null, null, 1_150],
    ])
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.lines.map((line) => line.costCode)).toEqual(["03 30 00"])
    expect(result).toMatchObject({ overheadCents: 10_000, marginCents: 5_000, contingencyCents: 0 })
  })

  it("keeps a coded fee row above the subtotal as a line under its canonical name", () => {
    const result = parseProjectTotalsRows([
      ["03 30 00 - Cast-in-Place Concrete", null, null, null, 1_000],
      ["99 30 00 - Contingency Reserve", null, null, null, 40],
      ["Project Total:", null, null, null, 1_040],
    ])
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.lines[1]).toMatchObject({
      costCode: "Contingency Reserve",
      costCodeName: "Contingency Reserve",
      divisionCode: "00",
      divisionName: "Procurement Requirements",
      amountCents: 4_000,
    })
  })
})
