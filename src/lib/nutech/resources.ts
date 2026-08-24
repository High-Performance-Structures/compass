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
  airliteTemplateId: "1WDYEMs5RgkoccbPSiFQsmeiNc7MRC_xsj6K0l1cmL6Y",
  newStandardSheetId: "1_xx7UbkT4qd3UvZBI6RT8AOs-yjbfmnfpJAVkdebl48",
  newCashSheetId: "19O7u_oq-sFZUZuExRDl4cDwQonD8sXcg5i4ZjfGlRJg",
  returningStandardSheetId: "1zHRvncvRNGwWVf7RYWTbNY2H7wnQfvmNbx9Bh9EXD1o",
  returningCashSheetId: "1uQygU-_QEsPYRQRpVMS4DEDH_DsTa2s88SC_EngxAWI",
  sourceRange: "'2026 Cost & Margin'!A1:H100",
} as const

export function nuTechPricingFolderUrl(
  customerType: "new" | "returning" | null
): string | null {
  if (customerType === "new") return NUTECH_RESOURCE_LINKS.newClientPricing
  if (customerType === "returning") {
    return NUTECH_RESOURCE_LINKS.returningCustomerPricing
  }
  return null
}
