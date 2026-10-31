import type { WeatherAlert } from "@/lib/weather/alerts"
import type { ActiveFire } from "@/lib/weather/fires"
import { milesBetween, milesToRing, pointInRing } from "@/lib/weather/geometry"
import { STEP_HOURS, type CellSeries } from "@/lib/weather/series"

/** The map's time bar: now through 48 hours ahead, in 3-hour steps. */
export const LAYER_STEPS = 17
/** Job flags at a step look this many steps ahead (24 hours). */
export const FLAG_WINDOW_STEPS = 24 / STEP_HOURS

export type WeatherLayerCell = {
  readonly lon: number
  readonly lat: number
  readonly series: CellSeries
}

export type JobWeather = {
  readonly projectId: string
  /** Elevation of the forecast grid cell covering the site. */
  readonly forecastElevationFt: number | null
  readonly series: CellSeries
}

export type WeatherLayerData = {
  /** ISO time of step 0 (the current 3-hour step). */
  readonly start: string
  readonly steps: number
  readonly areaKey: string
  readonly cells: readonly WeatherLayerCell[]
  /** Warnings except fire ones (those belong to the Fire & smoke layer). */
  readonly alerts: readonly WeatherAlert[]
  readonly jobs: readonly JobWeather[]
  /** Oldest forecast shown, so the map can say how fresh it is. */
  readonly updatedAt: string | null
  /** True while the first forecasts are still being gathered. */
  readonly warming: boolean
}

export type FireLayerData = {
  readonly areaKey: string
  readonly fires: readonly ActiveFire[]
  /** Red Flag Warnings and Fire Weather Watches. */
  readonly alerts: readonly WeatherAlert[]
  readonly updatedAt: string | null
}

/** Company limits that turn a forecast into a flag (Settings › Weather & fire alerts). */
export type WeatherLimits = {
  /** Snow in 24 hours, inches. */
  readonly snowIn: number
  /** Rain (liquid) in 24 hours, inches. */
  readonly rainIn: number
  readonly gustMph: number
  /** Extreme cold: low at or below, °F. */
  readonly coldF: number
  /** Extreme heat: high at or above, °F. */
  readonly heatF: number
  /** Active fire within this many miles of a job. */
  readonly fireMiles: number
}

export const DEFAULT_WEATHER_LIMITS: WeatherLimits = {
  snowIn: 4,
  rainIn: 0.5,
  gustMph: 30,
  coldF: 0,
  heatF: 95,
  fireMiles: 25,
}

export type WeatherFlagKind = "snow" | "rain" | "wind" | "cold" | "heat" | "warning" | "fire" | "red_flag"

export type WeatherFlag = {
  readonly kind: WeatherFlagKind
  /** Short map label, e.g. "SNOW 6 IN". */
  readonly label: string
  /** One sentence for the job list. */
  readonly detail: string
}

type WindowTotals = {
  readonly snowIn: number
  readonly rainIn: number
  readonly gustMph: number | null
  readonly lowF: number | null
  readonly highF: number | null
}

/** Totals over `count` steps starting at `from`. */
export function windowTotals(series: CellSeries, from: number, count: number): WindowTotals {
  let snowIn = 0
  let rainIn = 0
  let gustMph: number | null = null
  let lowF: number | null = null
  let highF: number | null = null
  for (let i = from; i < from + count; i += 1) {
    snowIn += series.snowIn[i] ?? 0
    rainIn += series.precipIn[i] ?? 0
    const gust = series.gustMph[i] ?? null
    if (gust !== null) gustMph = gustMph === null ? gust : Math.max(gustMph, gust)
    const low = series.tempMinF[i] ?? null
    if (low !== null) lowF = lowF === null ? low : Math.min(lowF, low)
    const high = series.tempMaxF[i] ?? null
    if (high !== null) highF = highF === null ? high : Math.max(highF, high)
  }
  return { snowIn, rainIn, gustMph, lowF, highF }
}

const inches = (value: number): string => (value >= 10 ? Math.round(value).toString() : value >= 1 ? value.toFixed(0) : value.toFixed(1))

/** Weather flags for one forecast over the 24 hours from `step`. */
export function forecastFlags(series: CellSeries, step: number, limits: WeatherLimits): WeatherFlag[] {
  const totals = windowTotals(series, step, FLAG_WINDOW_STEPS)
  const flags: WeatherFlag[] = []
  if (totals.snowIn >= limits.snowIn) {
    flags.push({ kind: "snow", label: `SNOW ${inches(totals.snowIn)} IN`, detail: `About ${inches(totals.snowIn)} in of snow in the next 24 hours.` })
  }
  // Rain only counts when it isn't falling as snow.
  const rainOnly = Math.max(0, totals.rainIn - totals.snowIn / 10)
  if (rainOnly >= limits.rainIn) {
    flags.push({ kind: "rain", label: `RAIN ${rainOnly.toFixed(1)} IN`, detail: `About ${rainOnly.toFixed(1)} in of rain in the next 24 hours.` })
  }
  if (totals.gustMph !== null && totals.gustMph >= limits.gustMph) {
    flags.push({ kind: "wind", label: `GUSTS ${totals.gustMph}`, detail: `Gusts to ${totals.gustMph} mph.` })
  }
  if (totals.lowF !== null && totals.lowF <= limits.coldF) {
    flags.push({ kind: "cold", label: `LOW ${totals.lowF}°F`, detail: `Low of ${totals.lowF}°F at the site.` })
  }
  if (totals.highF !== null && totals.highF >= limits.heatF) {
    flags.push({ kind: "heat", label: `HIGH ${totals.highF}°F`, detail: `High of ${totals.highF}°F at the site.` })
  }
  return flags
}

/** True when a warning is in effect at some point in [fromMs, toMs). */
export function alertActiveBetween(alert: WeatherAlert, fromMs: number, toMs: number): boolean {
  const onset = alert.onset ? Date.parse(alert.onset) : Number.NEGATIVE_INFINITY
  const ends = alert.ends ? Date.parse(alert.ends) : Number.POSITIVE_INFINITY
  return onset < toMs && ends > fromMs
}

export function alertCovers(alert: WeatherAlert, lon: number, lat: number): boolean {
  return alert.rings.some((ring) => pointInRing(lon, lat, ring))
}

/** Miles from a job to a fire's outline, or to its reported point when it has none. */
function milesToFire(fire: ActiveFire, lon: number, lat: number): number {
  if (fire.rings.length === 0) return milesBetween(lon, lat, fire.lon, fire.lat)
  return Math.min(...fire.rings.map((ring) => milesToRing(lon, lat, ring)))
}

const COMPASS_POINTS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"]

/** Direction from a job to a fire, e.g. "northwest". */
function bearingWord(fromLon: number, fromLat: number, toLon: number, toLat: number): string {
  const dx = (toLon - fromLon) * Math.cos((fromLat * Math.PI) / 180)
  const dy = toLat - fromLat
  const degrees = (Math.atan2(dx, dy) * 180) / Math.PI
  const index = Math.round(((degrees + 360) % 360) / 45) % 8
  return COMPASS_POINTS[index] ?? "north"
}

/** Fire flags for a job: Red Flag Warnings over it and fires within the company's distance. */
export function fireFlags(
  data: Pick<FireLayerData, "fires" | "alerts">,
  lon: number,
  lat: number,
  limits: Pick<WeatherLimits, "fireMiles">,
  nowMs: number,
): WeatherFlag[] {
  const flags: WeatherFlag[] = []
  for (const alert of data.alerts) {
    if (!alertActiveBetween(alert, nowMs, nowMs + 24 * 60 * 60 * 1000) || !alertCovers(alert, lon, lat)) continue
    flags.push({ kind: "red_flag", label: alert.event.toUpperCase(), detail: alert.headline })
  }
  const near = data.fires
    .map((fire) => ({ fire, miles: milesToFire(fire, lon, lat) }))
    .filter((entry) => entry.miles <= limits.fireMiles)
    .sort((a, b) => a.miles - b.miles)
  for (const { fire, miles } of near.slice(0, 2)) {
    const where = miles < 0.5 ? "at the site" : `${Math.round(miles)} mi ${bearingWord(lon, lat, fire.lon, fire.lat)}`
    const size = fire.acres !== null ? `${Math.round(fire.acres).toLocaleString("en-US")} acres` : "size not reported"
    const contained = fire.containedPercent !== null ? `, ${Math.round(fire.containedPercent)}% contained` : ""
    flags.push({ kind: "fire", label: `${fire.name.toUpperCase()} · ${miles < 0.5 ? "AT SITE" : `${Math.round(miles)} MI`}`, detail: `${fire.name}, ${where} (${size}${contained}).` })
  }
  return flags
}
