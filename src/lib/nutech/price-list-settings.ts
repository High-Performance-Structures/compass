import { z } from "zod/v4"

/**
 * Settings → Nu-Tech fields for the price list the catalog import reads. Blank
 * fields fall back to the built-in 2026 sheets (see nuTechCatalogSources), so a
 * new price year is a Settings change, not a code change.
 */
export const nuTechPriceListSettingsShape = {
  priceListName: z.string().max(80),
  priceListEffectiveDate: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, "Use YYYY-MM-DD"),
  newStandardPriceSheet: z.string().max(300),
  newCashPriceSheet: z.string().max(300),
  returningStandardPriceSheet: z.string().max(300),
  returningCashPriceSheet: z.string().max(300),
  /** Tab and cells the prices sit in, e.g. '2027 Cost & Margin'!A1:H100. */
  priceSheetRange: z.string().max(120),
}

export const NUTECH_PRICE_LIST_DEFAULTS = {
  priceListName: "",
  priceListEffectiveDate: "",
  newStandardPriceSheet: "",
  newCashPriceSheet: "",
  returningStandardPriceSheet: "",
  returningCashPriceSheet: "",
  priceSheetRange: "",
} as const
