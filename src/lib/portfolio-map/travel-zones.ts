import { z } from "zod/v4"

/**
 * Zone (travel) charges: an added cost per man-hour by straight-line distance
 * from the home base, plus a mountain charge by site elevation. Rates follow
 * fuel costs, so every value here is an editable organization setting; these
 * are only the starting defaults.
 */

export type TravelZone = {
  /** Whole miles; the last zone has no upper limit (null). */
  readonly maxMiles: number | null
  /** Null until the office enters a rate. */
  readonly ratePerManHourCents: number | null
  /** Far zones also carry lodging and per diem. */
  readonly lodgingAndPerDiem: boolean
}

export type MountainBand = {
  /** Applies to sites at or above this elevation (feet). */
  readonly minElevationFt: number
  /** Null until the office enters a rate. */
  readonly ratePerManHourCents: number | null
}

export type TravelHomeBase = {
  readonly label: string
  readonly lat: number
  readonly lon: number
}

export type TravelChargeSettings = {
  readonly homeBase: TravelHomeBase
  readonly zones: readonly TravelZone[]
  readonly mountainBands: readonly MountainBand[]
  readonly lodgingPerNightCents: number | null
  readonly perDiemPerDayCents: number | null
}

export const DEFAULT_TRAVEL_CHARGE_SETTINGS: TravelChargeSettings = {
  homeBase: { label: "Woodland Park", lat: 38.9938, lon: -105.057 },
  // Zone 0 (near home base) carries no charge.
  zones: [
    { maxMiles: 20, ratePerManHourCents: 0, lodgingAndPerDiem: false },
    { maxMiles: 34, ratePerManHourCents: 450, lodgingAndPerDiem: false },
    { maxMiles: 60, ratePerManHourCents: 600, lodgingAndPerDiem: false },
    { maxMiles: 84, ratePerManHourCents: 750, lodgingAndPerDiem: false },
    { maxMiles: null, ratePerManHourCents: 1000, lodgingAndPerDiem: true },
  ],
  // Elevation bands start without a rate until the office sets one.
  mountainBands: [
    { minElevationFt: 9000, ratePerManHourCents: null },
    { minElevationFt: 10000, ratePerManHourCents: null },
  ],
  lodgingPerNightCents: null,
  perDiemPerDayCents: 5000,
}

/**
 * Roles that may change the rates: administrators, company owners
 * (executive), office manager, project administrators and estimators.
 */
const TRAVEL_CHARGE_EDITOR_ROLES: ReadonlySet<string> = new Set([
  "admin",
  "secondary_admin",
  "executive",
  "office_manager",
  "project_administrator",
  "lead_estimator",
  "assistant_estimator",
])

export function canEditTravelCharges(role: string): boolean {
  return TRAVEL_CHARGE_EDITOR_ROLES.has(role)
}

const cents = z.number().int().min(0).max(1_000_000)

const zoneSchema = z.object({
  maxMiles: z.number().int().min(0).max(1000).nullable(),
  ratePerManHourCents: cents.nullable(),
  lodgingAndPerDiem: z.boolean(),
})

const bandSchema = z.object({
  minElevationFt: z.number().int().min(0).max(15000),
  ratePerManHourCents: cents.nullable(),
})

export const travelChargeSettingsSchema = z
  .object({
    homeBase: z.object({
      label: z.string().trim().min(1).max(80),
      lat: z.number().min(36).max(42),
      lon: z.number().min(-110).max(-101),
    }),
    zones: z.array(zoneSchema).min(1).max(8),
    mountainBands: z.array(bandSchema).max(6),
    lodgingPerNightCents: cents.nullable(),
    perDiemPerDayCents: cents.nullable(),
  })
  .superRefine((value, ctx) => {
    value.zones.forEach((zone, index) => {
      const last = index === value.zones.length - 1
      if (last !== (zone.maxMiles === null)) {
        ctx.addIssue({ code: "custom", message: "Only the last zone is open-ended.", path: ["zones", index] })
      }
      const previous = value.zones[index - 1]?.maxMiles
      if (index > 0 && zone.maxMiles !== null && previous !== null && previous !== undefined && zone.maxMiles <= previous) {
        ctx.addIssue({ code: "custom", message: "Zone distances must increase.", path: ["zones", index] })
      }
    })
    value.mountainBands.forEach((band, index) => {
      const previous = value.mountainBands[index - 1]
      if (previous && band.minElevationFt <= previous.minElevationFt) {
        ctx.addIssue({ code: "custom", message: "Elevation bands must increase.", path: ["mountainBands", index] })
      }
    })
  })

/** Stored settings, falling back to the defaults when missing or invalid. */
export function parseTravelChargeSettings(value: unknown): TravelChargeSettings {
  const parsed = travelChargeSettingsSchema.safeParse(value)
  return parsed.success ? parsed.data : DEFAULT_TRAVEL_CHARGE_SETTINGS
}

const EARTH_RADIUS_MILES = 3958.8

export function milesBetween(
  a: { readonly lat: number; readonly lon: number },
  b: { readonly lat: number; readonly lon: number },
): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Zone number (1-based) for a distance; boundaries are whole miles, so 25 is zone 1 and 26 is zone 2. */
export function travelZoneIndex(miles: number, zones: readonly TravelZone[]): number {
  const rounded = Math.round(miles)
  const index = zones.findIndex((zone) => zone.maxMiles === null || rounded <= zone.maxMiles)
  return index === -1 ? zones.length - 1 : index
}

/** Highest band the site reaches, or -1 below the first band. */
export function mountainBandIndex(elevationFt: number, bands: readonly MountainBand[]): number {
  let found = -1
  bands.forEach((band, index) => {
    if (elevationFt >= band.minElevationFt) found = index
  })
  return found
}

export type JobTravelCharge = {
  readonly miles: number
  /** Zone number as shown to people: zones count from 0. */
  readonly zone: number
  readonly zoneRateCents: number | null
  readonly lodgingAndPerDiem: boolean
  /** Band number (1-based), or null below the first band or without an elevation. */
  readonly mountainBand: number | null
  readonly mountainRateCents: number | null
  /** Distance is from the town center when the site address could not be located. */
  readonly approximate: boolean
}

export function jobTravelCharge(input: {
  readonly lat: number
  readonly lon: number
  readonly elevationFt: number | null
  readonly approximate: boolean
  readonly settings: TravelChargeSettings
}): JobTravelCharge {
  const { settings } = input
  const miles = milesBetween(settings.homeBase, input)
  const zoneIndex = travelZoneIndex(miles, settings.zones)
  const zone = settings.zones[zoneIndex]
  const bandIndex = input.elevationFt === null ? -1 : mountainBandIndex(input.elevationFt, settings.mountainBands)
  return {
    miles: Math.round(miles),
    zone: zoneIndex,
    zoneRateCents: zone?.ratePerManHourCents ?? null,
    lodgingAndPerDiem: zone?.lodgingAndPerDiem ?? false,
    mountainBand: bandIndex === -1 ? null : bandIndex + 1,
    mountainRateCents: settings.mountainBands[bandIndex]?.ratePerManHourCents ?? null,
    approximate: input.approximate,
  }
}

/** "0–24 mi", "25 mi", "26–60 mi", "81+ mi". */
export function zoneRangeLabel(zones: readonly TravelZone[], index: number): string {
  const zone = zones[index]
  const start = index === 0 ? 0 : (zones[index - 1]?.maxMiles ?? 0) + 1
  if (!zone) return ""
  if (zone.maxMiles === null) return `${start}+ mi`
  return zone.maxMiles === start ? `${start} mi` : `${start}–${zone.maxMiles} mi`
}

export function formatRateCents(value: number): string {
  return `$${(value / 100).toFixed(2)}`
}

/** "$6.00", "No charge" or "Rate not set". */
export function rateLabel(cents: number | null): string {
  if (cents === null) return "Rate not set"
  return cents === 0 ? "No charge" : formatRateCents(cents)
}
