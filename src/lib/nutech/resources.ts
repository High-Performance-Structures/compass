import { driveFileIdFromValue } from "@/lib/project-documents"

export const NUTECH_RESOURCE_LINKS = {
  airliteOrderForm:
    "https://docs.google.com/spreadsheets/d/1WDYEMs5RgkoccbPSiFQsmeiNc7MRC_xsj6K0l1cmL6Y/edit",
  newClientPricing:
    "https://drive.google.com/drive/folders/1qmczWk5bOmqSTflGmKFfYO1nHa-Duz9s",
  returningCustomerPricing:
    "https://drive.google.com/drive/folders/1Dl1c2ZSOwOPatIB3fOOPwjShfwL7RDQh",
  pricingArchive:
    "https://drive.google.com/drive/folders/1cRrvPXkwF0nzZNurWF6A-E5_rG8fmOjB",
} satisfies Readonly<Record<string, string>>

export const NUTECH_2026_CATALOG_SOURCES = {
  name: "2026 Fox Blocks pricing",
  effectiveDate: "2026-08-23",
  // Fox Blocks order form Rev 1/1/2026 (an .xlsx; copies convert to Sheets).
  // Settings → Nu-Tech "Manufacturer order form" overrides it.
  airliteTemplateId: "1Yqhb48MTZN89f0fFrFqTI4T0hr_KU2DC",
  newStandardSheetId: "1_xx7UbkT4qd3UvZBI6RT8AOs-yjbfmnfpJAVkdebl48",
  newCashSheetId: "19O7u_oq-sFZUZuExRDl4cDwQonD8sXcg5i4ZjfGlRJg",
  returningStandardSheetId: "1zHRvncvRNGwWVf7RYWTbNY2H7wnQfvmNbx9Bh9EXD1o",
  returningCashSheetId: "1uQygU-_QEsPYRQRpVMS4DEDH_DsTa2s88SC_EngxAWI",
  sourceRange: "'2026 Cost & Margin'!A1:H100",
} as const

export type NuTechCatalogSources = {
  readonly name: string
  readonly effectiveDate: string
  readonly airliteTemplateId: string
  readonly newStandardSheetId: string
  readonly newCashSheetId: string
  readonly returningStandardSheetId: string
  readonly returningCashSheetId: string
  readonly sourceRange: string
}

type NuTechPriceListSettings = {
  readonly priceListName: string
  readonly priceListEffectiveDate: string
  readonly orderFormFile: string
  readonly newStandardPriceSheet: string
  readonly newCashPriceSheet: string
  readonly returningStandardPriceSheet: string
  readonly returningCashPriceSheet: string
  readonly priceSheetRange: string
}

/**
 * The price list the catalog import reads: Settings → Nu-Tech wins field by
 * field, and anything left blank falls back to the 2026 sheets above, so a new
 * price year needs no code change.
 */
export function nuTechCatalogSources(settings: NuTechPriceListSettings): NuTechCatalogSources {
  const base = NUTECH_2026_CATALOG_SOURCES
  const text = (value: string, fallback: string): string => value.trim() || fallback
  const sheet = (value: string, fallback: string): string => driveFileIdFromValue(value) ?? fallback
  return {
    name: text(settings.priceListName, base.name),
    effectiveDate: text(settings.priceListEffectiveDate, base.effectiveDate),
    airliteTemplateId: sheet(settings.orderFormFile, base.airliteTemplateId),
    newStandardSheetId: sheet(settings.newStandardPriceSheet, base.newStandardSheetId),
    newCashSheetId: sheet(settings.newCashPriceSheet, base.newCashSheetId),
    returningStandardSheetId: sheet(settings.returningStandardPriceSheet, base.returningStandardSheetId),
    returningCashSheetId: sheet(settings.returningCashPriceSheet, base.returningCashSheetId),
    sourceRange: text(settings.priceSheetRange, base.sourceRange),
  }
}

/** The tab name inside a range like '2026 Cost & Margin'!A1:H100. */
export function priceSheetTabName(sourceRange: string): string {
  return sourceRange.split("!")[0]?.replaceAll("'", "") ?? ""
}

export function nuTechPricingFolderUrl(
  customerType: "new" | "returning" | null
): string | null {
  if (customerType === "new") return NUTECH_RESOURCE_LINKS.newClientPricing
  if (customerType === "returning") {
    return NUTECH_RESOURCE_LINKS.returningCustomerPricing
  }
  return null
}
