import { z } from "zod/v4"
import {
  mountainBandIndex,
  type JobTravelCharge,
  type TravelChargeSettings,
} from "@/lib/portfolio-map/travel-zones"

/**
 * Per-job zone charge adjustments. Every field is optional: null keeps the
 * organization default, so defaults can be revised (for example after a fuel
 * review) without touching jobs that were set by hand.
 */
export type TravelChargeOverride = {
  /** Charge this job as a different distance zone (0-based). */
  readonly zoneIndex: number | null
  /** Custom zone rate per man-hour; wins over the zone's rate. */
  readonly zoneRateCents: number | null
  /** Corrected site elevation when the address lookup is off. */
  readonly siteElevationFt: number | null
  /** Custom mountain rate per man-hour; wins over the band's rate. */
  readonly mountainRateCents: number | null
  readonly lodging: "default" | "yes" | "no"
  readonly lodgingPerNightCents: number | null
  readonly perDiemPerDayCents: number | null
  readonly note: string | null
}

export const EMPTY_TRAVEL_OVERRIDE: TravelChargeOverride = {
  zoneIndex: null,
  zoneRateCents: null,
  siteElevationFt: null,
  mountainRateCents: null,
  lodging: "default",
  lodgingPerNightCents: null,
  perDiemPerDayCents: null,
  note: null,
}

const cents = z.number().int().min(0).max(1_000_000).nullable()

export const travelChargeOverrideSchema = z.object({
  zoneIndex: z.number().int().min(0).max(7).nullable(),
  zoneRateCents: cents,
  siteElevationFt: z.number().int().min(0).max(15000).nullable(),
  mountainRateCents: cents,
  lodging: z.enum(["default", "yes", "no"]),
  lodgingPerNightCents: cents,
  perDiemPerDayCents: cents,
  note: z.string().trim().max(500).nullable().transform((value) => (value ? value : null)),
})

export function hasTravelOverride(override: TravelChargeOverride): boolean {
  return (
    override.zoneIndex !== null ||
    override.zoneRateCents !== null ||
    override.siteElevationFt !== null ||
    override.mountainRateCents !== null ||
    override.lodging !== "default" ||
    override.lodgingPerNightCents !== null ||
    override.perDiemPerDayCents !== null ||
    override.note !== null
  )
}

export type CustomTravelField = "zone" | "zoneRate" | "elevation" | "mountainRate" | "lodging" | "lodgingRate" | "perDiem"

export type EffectiveTravelCharge = JobTravelCharge & {
  readonly elevationFt: number | null
  readonly lodgingPerNightCents: number | null
  readonly perDiemPerDayCents: number | null
  /** Which values come from this job's adjustments rather than the defaults. */
  readonly custom: readonly CustomTravelField[]
  readonly note: string | null
}

/**
 * The job's charge with its adjustments applied. Distance stays measured;
 * a zone override changes which zone's rate and lodging apply, and a
 * corrected elevation re-picks the mountain band.
 */
export function applyTravelOverride(
  base: JobTravelCharge & { readonly elevationFt: number | null },
  override: TravelChargeOverride | null,
  settings: TravelChargeSettings,
): EffectiveTravelCharge {
  const custom: CustomTravelField[] = []
  const ov = override ?? EMPTY_TRAVEL_OVERRIDE
  let zone = base.zone
  let zoneRateCents = base.zoneRateCents
  let lodgingAndPerDiem = base.lodgingAndPerDiem
  const zoneSetting = ov.zoneIndex === null ? undefined : settings.zones[ov.zoneIndex]
  if (ov.zoneIndex !== null && zoneSetting) {
    zone = ov.zoneIndex
    zoneRateCents = zoneSetting.ratePerManHourCents
    lodgingAndPerDiem = zoneSetting.lodgingAndPerDiem
    custom.push("zone")
  }
  if (ov.zoneRateCents !== null) {
    zoneRateCents = ov.zoneRateCents
    custom.push("zoneRate")
  }
  let elevationFt = base.elevationFt
  let mountainBand = base.mountainBand
  let mountainRateCents = base.mountainRateCents
  if (ov.siteElevationFt !== null) {
    elevationFt = ov.siteElevationFt
    const bandIndex = mountainBandIndex(ov.siteElevationFt, settings.mountainBands)
    mountainBand = bandIndex === -1 ? null : bandIndex + 1
    mountainRateCents = settings.mountainBands[bandIndex]?.ratePerManHourCents ?? null
    custom.push("elevation")
  }
  if (ov.mountainRateCents !== null) {
    mountainRateCents = ov.mountainRateCents
    custom.push("mountainRate")
  }
  if (ov.lodging !== "default") {
    lodgingAndPerDiem = ov.lodging === "yes"
    custom.push("lodging")
  }
  const lodgingPerNightCents = ov.lodgingPerNightCents ?? settings.lodgingPerNightCents
  if (ov.lodgingPerNightCents !== null) custom.push("lodgingRate")
  const perDiemPerDayCents = ov.perDiemPerDayCents ?? settings.perDiemPerDayCents
  if (ov.perDiemPerDayCents !== null) custom.push("perDiem")
  return {
    ...base,
    zone,
    zoneRateCents,
    lodgingAndPerDiem,
    elevationFt,
    mountainBand,
    mountainRateCents,
    lodgingPerNightCents,
    perDiemPerDayCents,
    custom,
    note: ov.note,
  }
}
