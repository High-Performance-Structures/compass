import { describe, expect, it } from "vitest"
import {
  FEATURE_SETTINGS,
  nuTechPriceSourcesSettingsSchema,
  parseFeatureSettings,
} from "@/lib/feature-settings/registry"
import {
  NUTECH_2026_CATALOG_SOURCES,
  nuTechCatalogSourceRange,
  spreadsheetIdFromValue,
} from "@/lib/nutech/resources"

describe("spreadsheetIdFromValue", () => {
  it("reads the id from a pasted Google Sheets link", () => {
    expect(
      spreadsheetIdFromValue(
        "https://docs.google.com/spreadsheets/d/1_xx7UbkT4qd3UvZBI6RT8AOs-yjbfmnfpJAVkdebl48/edit#gid=0",
      ),
    ).toBe("1_xx7UbkT4qd3UvZBI6RT8AOs-yjbfmnfpJAVkdebl48")
  })

  it("accepts a bare id", () => {
    expect(spreadsheetIdFromValue(" 19O7u_oq-sFZUZuExRDl4cDwQonD8sXcg5i4ZjfGlRJg ")).toBe(
      "19O7u_oq-sFZUZuExRDl4cDwQonD8sXcg5i4ZjfGlRJg",
    )
  })

  it("rejects text that isn't a sheet", () => {
    expect(spreadsheetIdFromValue("price list")).toBeNull()
    expect(spreadsheetIdFromValue("")).toBeNull()
  })
})

describe("nuTechCatalogSourceRange", () => {
  it("quotes the tab name, including apostrophes", () => {
    expect(nuTechCatalogSourceRange("2026 Cost & Margin")).toBe("'2026 Cost & Margin'!A1:H100")
    expect(nuTechCatalogSourceRange("Martine's prices")).toBe("'Martine''s prices'!A1:H100")
  })

  it("matches the range the original 2026 import used", () => {
    expect(nuTechCatalogSourceRange(FEATURE_SETTINGS["nutech-price-sources"].defaults.sourceTab)).toBe(
      NUTECH_2026_CATALOG_SOURCES.sourceRange,
    )
  })
})

describe("Nu-Tech price list sources setting", () => {
  it("defaults to the current 2026 sheets, so nothing changes until edited", () => {
    const defaults = parseFeatureSettings("nutech-price-sources", null)
    expect(defaults).toMatchObject({
      catalogName: NUTECH_2026_CATALOG_SOURCES.name,
      effectiveDate: NUTECH_2026_CATALOG_SOURCES.effectiveDate,
      newStandardSheet: NUTECH_2026_CATALOG_SOURCES.newStandardSheetId,
      returningCashSheet: NUTECH_2026_CATALOG_SOURCES.returningCashSheetId,
    })
    expect(nuTechPriceSourcesSettingsSchema.safeParse(defaults).success).toBe(true)
  })

  it("keeps a saved new year's sheets", () => {
    const saved = parseFeatureSettings(
      "nutech-price-sources",
      JSON.stringify({
        catalogName: "2027 Fox Blocks pricing",
        effectiveDate: "2027-01-01",
        newStandardSheet: "https://docs.google.com/spreadsheets/d/1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/edit",
        sourceTab: "2027 Cost & Margin",
      }),
    )
    expect(saved.catalogName).toBe("2027 Fox Blocks pricing")
    expect(saved.sourceTab).toBe("2027 Cost & Margin")
    expect(spreadsheetIdFromValue(saved.newStandardSheet)).toBe("1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
    // Fields not saved keep their defaults.
    expect(saved.newCashSheet).toBe(NUTECH_2026_CATALOG_SOURCES.newCashSheetId)
  })

  it("rejects a link that isn't a Google Sheet", () => {
    const result = nuTechPriceSourcesSettingsSchema.safeParse({
      ...FEATURE_SETTINGS["nutech-price-sources"].defaults,
      newCashSheet: "see Drive",
    })
    expect(result.success).toBe(false)
  })
})
