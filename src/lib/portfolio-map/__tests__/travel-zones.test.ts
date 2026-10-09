import { describe, expect, it } from "vitest"
import {
  canEditTravelCharges,
  DEFAULT_TRAVEL_CHARGE_SETTINGS,
  jobTravelCharge,
  milesBetween,
  mountainBandIndex,
  parseTravelChargeSettings,
  rateLabel,
  travelChargeSettingsSchema,
  travelZoneIndex,
  zoneRangeLabel,
} from "../travel-zones"

const zones = DEFAULT_TRAVEL_CHARGE_SETTINGS.zones

describe("travel zones", () => {
  it("uses whole-mile boundaries, counting zones from 0", () => {
    expect(travelZoneIndex(20.4, zones)).toBe(0)
    expect(travelZoneIndex(20.6, zones)).toBe(1)
    expect(travelZoneIndex(34, zones)).toBe(1)
    expect(travelZoneIndex(35, zones)).toBe(2)
    expect(travelZoneIndex(60, zones)).toBe(2)
    expect(travelZoneIndex(61, zones)).toBe(3)
    expect(travelZoneIndex(84, zones)).toBe(3)
    expect(travelZoneIndex(85, zones)).toBe(4)
    expect(travelZoneIndex(400, zones)).toBe(4)
  })

  it("labels ranges and rates", () => {
    expect(zones.map((_, index) => zoneRangeLabel(zones, index))).toEqual([
      "0–20 mi",
      "21–34 mi",
      "35–60 mi",
      "61–84 mi",
      "85+ mi",
    ])
    expect(zones.map((zone) => rateLabel(zone.ratePerManHourCents))).toEqual([
      "No charge",
      "$4.50",
      "$6.00",
      "$7.50",
      "$10.00",
    ])
    expect(rateLabel(null)).toBe("Rate not set")
  })

  it("starts per diem at $50 and leaves lodging and mountain rates blank", () => {
    expect(DEFAULT_TRAVEL_CHARGE_SETTINGS.perDiemPerDayCents).toBe(5000)
    expect(DEFAULT_TRAVEL_CHARGE_SETTINGS.lodgingPerNightCents).toBeNull()
    expect(DEFAULT_TRAVEL_CHARGE_SETTINGS.mountainBands.every((band) => band.ratePerManHourCents === null)).toBe(true)
  })

  it("measures straight-line miles", () => {
    // Woodland Park to Colorado Springs is about 17 miles.
    expect(milesBetween(DEFAULT_TRAVEL_CHARGE_SETTINGS.homeBase, { lat: 38.834, lon: -104.8253 })).toBeCloseTo(16.6, 0)
  })

  it("finds the highest mountain band reached", () => {
    const bands = DEFAULT_TRAVEL_CHARGE_SETTINGS.mountainBands
    expect(mountainBandIndex(8999, bands)).toBe(-1)
    expect(mountainBandIndex(9000, bands)).toBe(0)
    expect(mountainBandIndex(11200, bands)).toBe(1)
  })

  it("builds a job's charge", () => {
    // Denver is about 52 miles out: zone 2.
    const charge = jobTravelCharge({
      lat: 39.74,
      lon: -104.99,
      elevationFt: 5280,
      approximate: false,
      settings: DEFAULT_TRAVEL_CHARGE_SETTINGS,
    })
    expect(charge.zone).toBe(2)
    expect(charge.zoneRateCents).toBe(600)
    expect(charge.mountainBand).toBeNull()
    expect(charge.lodgingAndPerDiem).toBe(false)
    // Alma (10,349 ft) reaches band 2, whose rate is not set yet.
    const alma = jobTravelCharge({
      lat: 39.284,
      lon: -106.062,
      elevationFt: 10349,
      approximate: false,
      settings: DEFAULT_TRAVEL_CHARGE_SETTINGS,
    })
    expect(alma.mountainBand).toBe(2)
    expect(alma.mountainRateCents).toBeNull()
  })

  it("rejects out-of-order or open-ended middle zones and falls back to defaults", () => {
    const bad = { ...DEFAULT_TRAVEL_CHARGE_SETTINGS, zones: [zones[1], zones[0], zones[4]] }
    expect(travelChargeSettingsSchema.safeParse(bad).success).toBe(false)
    const openMiddle = { ...DEFAULT_TRAVEL_CHARGE_SETTINGS, zones: [zones[4], zones[4]] }
    expect(travelChargeSettingsSchema.safeParse(openMiddle).success).toBe(false)
    expect(parseTravelChargeSettings("nope")).toBe(DEFAULT_TRAVEL_CHARGE_SETTINGS)
    expect(parseTravelChargeSettings(DEFAULT_TRAVEL_CHARGE_SETTINGS)).toEqual(DEFAULT_TRAVEL_CHARGE_SETTINGS)
  })

  it("lets owners, office manager, project administrators and estimators edit rates", () => {
    for (const role of ["admin", "executive", "office_manager", "project_administrator", "lead_estimator", "assistant_estimator"]) {
      expect(canEditTravelCharges(role)).toBe(true)
    }
    for (const role of ["project_manager", "field_crew", "client", "subcontractor"]) {
      expect(canEditTravelCharges(role)).toBe(false)
    }
  })
})
