import { describe, expect, it } from "vitest"
import {
  applyTravelOverride,
  EMPTY_TRAVEL_OVERRIDE,
  hasTravelOverride,
  travelChargeOverrideSchema,
} from "@/lib/portfolio-map/travel-overrides"
import { DEFAULT_TRAVEL_CHARGE_SETTINGS, type TravelChargeSettings } from "@/lib/portfolio-map/travel-zones"

const settings: TravelChargeSettings = {
  ...DEFAULT_TRAVEL_CHARGE_SETTINGS,
  mountainBands: [
    { minElevationFt: 9000, ratePerManHourCents: 200 },
    { minElevationFt: 10000, ratePerManHourCents: 400 },
  ],
  lodgingPerNightCents: 14000,
}

const base = {
  miles: 57,
  zone: 2,
  zoneRateCents: 600,
  lodgingAndPerDiem: false,
  mountainBand: null,
  mountainRateCents: null,
  approximate: true,
  elevationFt: 8200,
}

describe("applyTravelOverride", () => {
  it("returns the defaults when nothing is adjusted", () => {
    const result = applyTravelOverride(base, null, settings)
    expect(result.custom).toEqual([])
    expect(result.zoneRateCents).toBe(600)
    expect(result.lodgingPerNightCents).toBe(14000)
    expect(result.perDiemPerDayCents).toBe(5000)
  })

  it("re-picks the mountain band from a corrected elevation and adds lodging", () => {
    const result = applyTravelOverride(base, { ...EMPTY_TRAVEL_OVERRIDE, siteElevationFt: 10350, lodging: "yes" }, settings)
    expect(result.elevationFt).toBe(10350)
    expect(result.mountainBand).toBe(2)
    expect(result.mountainRateCents).toBe(400)
    expect(result.lodgingAndPerDiem).toBe(true)
    expect(result.miles).toBe(57)
    expect(result.custom).toEqual(["elevation", "lodging"])
  })

  it("uses another zone's rate and lodging, with a custom rate winning", () => {
    const zoned = applyTravelOverride(base, { ...EMPTY_TRAVEL_OVERRIDE, zoneIndex: 4 }, settings)
    expect(zoned.zone).toBe(4)
    expect(zoned.zoneRateCents).toBe(1000)
    expect(zoned.lodgingAndPerDiem).toBe(true)
    const custom = applyTravelOverride(base, { ...EMPTY_TRAVEL_OVERRIDE, zoneIndex: 4, zoneRateCents: 1250, lodging: "no" }, settings)
    expect(custom.zoneRateCents).toBe(1250)
    expect(custom.lodgingAndPerDiem).toBe(false)
  })

  it("ignores a zone that no longer exists in the settings", () => {
    const result = applyTravelOverride(base, { ...EMPTY_TRAVEL_OVERRIDE, zoneIndex: 7 }, settings)
    expect(result.zone).toBe(2)
    expect(result.custom).toEqual([])
  })
})

describe("override input", () => {
  it("treats a blank note as no note and detects empty overrides", () => {
    const parsed = travelChargeOverrideSchema.parse({ ...EMPTY_TRAVEL_OVERRIDE, note: "   " })
    expect(parsed.note).toBeNull()
    expect(hasTravelOverride(parsed)).toBe(false)
    expect(hasTravelOverride({ ...parsed, lodging: "yes" })).toBe(true)
  })
})
