import { describe, expect, it } from "vitest"

import { compareEstimateVersions } from "@/lib/estimates/version-comparison"

describe("compareEstimateVersions", () => {
  it("aggregates repeated cost codes and identifies cost changes", () => {
    const comparison = compareEstimateVersions({
      baseLines: [
        {
          divisionCode: "03",
          divisionName: "Concrete",
          costCode: "03-100",
          description: "Footings",
          lineTotalCents: 10_000,
        },
        {
          divisionCode: "03",
          divisionName: "Concrete",
          costCode: "03-100",
          description: "Slab",
          lineTotalCents: 20_000,
        },
      ],
      revisedLines: [
        {
          divisionCode: "03",
          divisionName: "Concrete",
          costCode: "03-100",
          description: "Footings",
          lineTotalCents: 15_000,
        },
        {
          divisionCode: "03",
          divisionName: "Concrete",
          costCode: "03-100",
          description: "Slab",
          lineTotalCents: 20_000,
        },
      ],
    })

    expect(comparison.baseTotalCents).toBe(30_000)
    expect(comparison.revisedTotalCents).toBe(35_000)
    expect(comparison.deltaCents).toBe(5_000)
    expect(comparison.changedRowCount).toBe(1)
    expect(comparison.divisions[0]?.rows[0]).toMatchObject({
      baseDescription: "Footings / Slab",
      revisedDescription: "Footings / Slab",
      baseTotalCents: 30_000,
      revisedTotalCents: 35_000,
      change: "changed",
    })
  })

  it("marks added, removed, and unchanged cost codes", () => {
    const comparison = compareEstimateVersions({
      baseLines: [
        {
          divisionCode: "01",
          divisionName: "General Requirements",
          costCode: "01-100",
          description: "Supervision",
          lineTotalCents: 8_000,
        },
        {
          divisionCode: "02",
          divisionName: "Existing Conditions",
          costCode: "02-100",
          description: "Demo",
          lineTotalCents: 2_000,
        },
      ],
      revisedLines: [
        {
          divisionCode: "01",
          divisionName: "General Requirements",
          costCode: "01-100",
          description: "Supervision",
          lineTotalCents: 8_000,
        },
        {
          divisionCode: "03",
          divisionName: "Concrete",
          costCode: "03-100",
          description: "Foundations",
          lineTotalCents: 5_000,
        },
      ],
    })

    const rows = comparison.divisions.flatMap((division) => division.rows)
    expect(rows.map((row) => [row.costCode, row.change])).toEqual([
      ["01-100", "unchanged"],
      ["02-100", "removed"],
      ["03-100", "added"],
    ])
    expect(comparison.changedRowCount).toBe(2)
    expect(comparison.deltaCents).toBe(3_000)
  })
})
