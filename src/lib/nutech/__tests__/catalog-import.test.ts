import { describe, expect, it } from "vitest"

import {
  buildNuTechCatalogImport,
  nuTechSageCostCodeCandidates,
} from "@/lib/nutech/catalog-import"

type SourceRow = readonly [
  string,
  string,
  string,
  string | number,
  number | null,
  number,
  number,
]

function sheet(
  margin: number,
  rows: readonly SourceRow[]
): ReadonlyArray<ReadonlyArray<unknown>> {
  return [
    ["Nu-Tech 2026 Pricing Basis"],
    ["Target gross margin", margin],
    ["Effective date", "August 23, 2026"],
    [
      "Origin",
      "Product",
      "SKU",
      "Bundle Qty",
      "SF/Form",
      "Airlite Cost",
      "Gross Margin",
      "Customer Price",
    ],
    ...rows.map((row) => [...row.slice(0, 6), margin, row[6]]),
  ]
}

function withPrice(row: SourceRow, price: number): SourceRow {
  return [row[0], row[1], row[2], row[3], row[4], row[5], price]
}

const sourceRows = [
  ["CSC", "Straight", "FOX-S600A", 12, 5.33, 21.9, 26.4],
  ["Omaha", "Fox Web 4\"", "L921T809B", "230/box", null, 161, 194],
] as const

describe("Nu-Tech catalog import", () => {
  it("joins the four published price sheets and preserves exact price tiers", () => {
    const catalog = buildNuTechCatalogImport({
      newStandard: sheet(0.17, sourceRows),
      newCash: sheet(0.145, [
        withPrice(sourceRows[0], 25.6),
        withPrice(sourceRows[1], 188.3),
      ]),
      returningStandard: sheet(0.145, [
        withPrice(sourceRows[0], 25.6),
        withPrice(sourceRows[1], 188.3),
      ]),
      returningCash: sheet(0.117, [
        withPrice(sourceRows[0], 24.8),
        withPrice(sourceRows[1], 182.35),
      ]),
    })

    expect(catalog.targetMargins).toEqual({
      newStandardBasisPoints: 1700,
      newCashBasisPoints: 1450,
      returningStandardBasisPoints: 1450,
      returningCashBasisPoints: 1170,
    })
    expect(catalog.products[0]).toMatchObject({
      manufacturerSku: "FOX-S600A",
      category: "block",
      minimumOrderIncrement: 12,
      priceUnit: "each",
      airliteTemplateSku: "FOX-S600",
      airliteTemplateRow: 28,
      airliteMappingStatus: "mapped",
      newStandardPriceCents: 2640,
      returningCashPriceCents: 2480,
    })
    expect(catalog.products[1]).toMatchObject({
      manufacturerSku: "L921T809B",
      category: "web",
      packageQuantity: 230,
      minimumOrderIncrement: 1,
      priceUnit: "box",
      airliteMappingStatus: "addendum_required",
    })
  })

  it("rejects a tier whose cost no longer agrees with the source catalog", () => {
    expect(() =>
      buildNuTechCatalogImport({
        newStandard: sheet(0.17, sourceRows),
        newCash: sheet(0.145, [
          ["CSC", "Straight", "FOX-S600A", 12, 5.33, 22, 25.6],
          withPrice(sourceRows[1], 188.3),
        ]),
        returningStandard: sheet(0.145, sourceRows),
        returningCash: sheet(0.117, sourceRows),
      })
    ).toThrow("does not match the product definition for FOX-S600A")
  })

  it("suggests Sage matches without automatically assigning them", () => {
    expect(
      nuTechSageCostCodeCandidates(
        { manufacturerSku: "FOX-S600A", name: "6 inch straight block" },
        [
          {
            id: "sage-1",
            code: "FOX-S600A",
            description: "Fox block material",
          },
          {
            id: "sage-2",
            code: "03 11 19",
            description: "Insulating concrete form",
          },
        ]
      )
    ).toEqual([
      {
        id: "sage-1",
        code: "FOX-S600A",
        description: "Fox block material",
        score: 100,
      },
    ])
  })
})
