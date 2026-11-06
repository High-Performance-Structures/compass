import { z } from "zod/v4"

/** Nu-Tech's company settings groups; registered in the feature-settings registry. */

/**
 * Nu-Tech bracing rentals: the equipment and sizes on the rental form, how
 * many the company owns (for availability), the daily rate per brace, and
 * what is required before equipment goes out.
 */
export const bracingRentalSettingsSchema = z.object({
  dailyRateCents: z.number().int().min(0).max(100_000),
  /** The item whose count is the number of braces billed per day. */
  billedItemKey: z.string().min(1).max(40),
  sizes: z.array(z.string().trim().min(1).max(20)).max(8),
  items: z
    .array(
      z.object({
        key: z.string().regex(/^[a-z0-9_]{1,40}$/),
        label: z.string().trim().min(1, "Name the item.").max(60),
        /** Owned, by size ("" when the item has no size). */
        owned: z.record(z.string().max(20), z.number().int().min(0).max(100_000)),
      }),
    )
    .min(1)
    .max(30),
  minDepositPercent: z.number().int().min(0).max(100),
  requireIdCopy: z.boolean(),
})

export type BracingRentalSettings = z.infer<typeof bracingRentalSettingsSchema>

/**
 * When an order lands in a "needs attention" box on the Nu-Tech order board.
 * Day counts are calendar days except the manufacturer confirmation wait,
 * which counts business days.
 */
export const nuTechOrderBoardSettingsSchema = z.object({
  /** "Ships soon": a requested pickup or delivery within this many days. */
  shipsWithinDays: z.number().int().min(1).max(60),
  /** "Not confirmed": a released PO with no confirmation after this many business days. */
  confirmationBusinessDays: z.number().int().min(0).max(20),
  /** "No invoice": confirmed, the pickup or delivery date this many days past, and no vendor invoice. */
  invoiceAfterDeliveryDays: z.number().int().min(0).max(60),
})

export type NuTechOrderBoardSettings = z.infer<typeof nuTechOrderBoardSettingsSchema>

export const DEFAULT_BRACING_RENTAL_SETTINGS: BracingRentalSettings = {
  dailyRateCents: 400,
  billedItemKey: "strongback_channel",
  sizes: ["9 ft", "10 ft", "12 ft", "Tall"],
  items: [
    { key: "turnbuckle", label: "7-11 Turnbuckle", owned: {} },
    { key: "strongback_channel", label: "Strongback Channel", owned: {} },
    { key: "platform_bracket", label: "Platform Bracket", owned: {} },
    { key: "guardrail_post", label: "Guardrail Post", owned: {} },
    { key: "platform_pin", label: "9/16 x 6 Platform Pin", owned: {} },
    { key: "safety_pin", label: "Safety Pin", owned: {} },
    { key: "tall_wall_turnbuckle", label: "Tall Wall Turnbuckle", owned: {} },
    { key: "strongback_coupler", label: "Strongback Coupler", owned: {} },
  ],
  minDepositPercent: 50,
  requireIdCopy: true,
}

export const DEFAULT_NUTECH_ORDER_BOARD_SETTINGS: NuTechOrderBoardSettings = {
  shipsWithinDays: 7,
  confirmationBusinessDays: 1,
  invoiceAfterDeliveryDays: 3,
}
