import { describe, expect, it } from "vitest"
import { bracingAvailability, bracingCharges, bracingRentalDays, bracingSignOutIssues } from "@/lib/nutech/bracing"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"

const line = (itemKey: string, quantityOut: number, extra: Partial<{ size: string; quantityReturned: number; damageCents: number }> = {}) => ({
  itemKey,
  size: extra.size ?? "10 ft",
  quantityOut,
  quantityReturned: extra.quantityReturned ?? 0,
  quantityDamaged: 0,
  damageCents: extra.damageCents ?? 0,
})

describe("bracing rentals", () => {
  it("counts the day out and the day back", () => {
    expect(bracingRentalDays("2026-05-08", "2026-05-08", "2026-06-01")).toBe(1)
    expect(bracingRentalDays("2026-05-08", "2026-05-25", "2026-06-01")).toBe(18)
    expect(bracingRentalDays("2026-05-08", null, "2026-05-10")).toBe(3)
    expect(bracingRentalDays(null, null, "2026-05-10")).toBe(0)
    expect(bracingRentalDays("2026-05-10", "2026-05-08", "2026-05-10")).toBe(0)
  })

  it("bills braces by the counted item, adds damage, and takes off the deposit", () => {
    const charges = bracingCharges({
      lines: [line("strongback_channel", 52), line("turnbuckle", 52), line("platform_pin", 52, { damageCents: 2500 })],
      billedItemKey: "strongback_channel",
      dailyRateCents: 400,
      days: 10,
      depositCents: 100_000,
    })
    expect(charges).toEqual({ braces: 52, days: 10, rentCents: 208_000, damageCents: 2500, depositCents: 100_000, balanceCents: 110_500 })
  })

  it("holds sign-out until the deposit and ID rules are met", () => {
    const settings = { minDepositPercent: 50, requireIdCopy: true }
    expect(bracingSignOutIssues({ settings, idCopyReceived: false, depositCents: 0, expectedRentCents: 10_000, quantityOut: 0 })).toHaveLength(3)
    expect(bracingSignOutIssues({ settings, idCopyReceived: true, depositCents: 5_000, expectedRentCents: 10_000, quantityOut: 4 })).toEqual([])
    expect(bracingSignOutIssues({ settings: { minDepositPercent: 0, requireIdCopy: false }, idCopyReceived: false, depositCents: 0, expectedRentCents: 10_000, quantityOut: 4 })).toEqual([])
  })

  it("shows what is left on the shelf by item and size", () => {
    const items = [{ key: "strongback_channel", label: "Strongback Channel", owned: { "10 ft": 120, "12 ft": 40 } }]
    const rows = bracingAvailability(items, ["10 ft", "12 ft"], [line("strongback_channel", 52, { quantityReturned: 2 }), line("strongback_channel", 80)])
    expect(rows).toEqual([
      { itemKey: "strongback_channel", label: "Strongback Channel", size: "10 ft", owned: 120, out: 130, available: -10 },
      { itemKey: "strongback_channel", label: "Strongback Channel", size: "12 ft", owned: 40, out: 0, available: 40 },
    ])
  })

  it("ships defaults that match the rental form and validate", () => {
    const defaults = FEATURE_SETTINGS["bracing-rentals"].defaults
    expect(FEATURE_SETTINGS["bracing-rentals"].schema.safeParse(defaults).success).toBe(true)
    expect(defaults.items.some((item) => item.key === defaults.billedItemKey)).toBe(true)
    expect(defaults.dailyRateCents).toBe(400)
  })
})
