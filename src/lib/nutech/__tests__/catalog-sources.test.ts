import { describe, expect, it } from "vitest"

import { NUTECH_2026_CATALOG_SOURCES, nuTechCatalogSources, priceSheetTabName } from "@/lib/nutech/resources"

const blank = {
  priceListName: "",
  priceListEffectiveDate: "",
  orderFormFile: "",
  newStandardPriceSheet: "",
  newCashPriceSheet: "",
  returningStandardPriceSheet: "",
  returningCashPriceSheet: "",
  priceSheetRange: "",
}

describe("nuTechCatalogSources", () => {
  it("uses the 2026 sheets when Settings is blank", () => {
    expect(nuTechCatalogSources(blank)).toEqual({
      name: NUTECH_2026_CATALOG_SOURCES.name,
      effectiveDate: NUTECH_2026_CATALOG_SOURCES.effectiveDate,
      airliteTemplateId: NUTECH_2026_CATALOG_SOURCES.airliteTemplateId,
      newStandardSheetId: NUTECH_2026_CATALOG_SOURCES.newStandardSheetId,
      newCashSheetId: NUTECH_2026_CATALOG_SOURCES.newCashSheetId,
      returningStandardSheetId: NUTECH_2026_CATALOG_SOURCES.returningStandardSheetId,
      returningCashSheetId: NUTECH_2026_CATALOG_SOURCES.returningCashSheetId,
      sourceRange: NUTECH_2026_CATALOG_SOURCES.sourceRange,
    })
  })

  it("takes each sheet from Settings, from a link or a bare file ID", () => {
    const sources = nuTechCatalogSources({
      ...blank,
      priceListName: " 2027 Fox Blocks pricing ",
      priceListEffectiveDate: "2027-01-15",
      newStandardPriceSheet: "https://docs.google.com/spreadsheets/d/NEWSTD2027/edit#gid=0",
      newCashPriceSheet: "NEWCASH2027",
      priceSheetRange: "'2027 Cost & Margin'!A1:H120",
    })
    expect(sources.name).toBe("2027 Fox Blocks pricing")
    expect(sources.effectiveDate).toBe("2027-01-15")
    expect(sources.newStandardSheetId).toBe("NEWSTD2027")
    expect(sources.newCashSheetId).toBe("NEWCASH2027")
    // Fields left blank keep the 2026 sheet.
    expect(sources.returningCashSheetId).toBe(NUTECH_2026_CATALOG_SOURCES.returningCashSheetId)
    expect(priceSheetTabName(sources.sourceRange)).toBe("2027 Cost & Margin")
  })
})
