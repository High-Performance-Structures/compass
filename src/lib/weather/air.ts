import { milesBetween, pointInRing, ringBounds, roundCoord, simplifyRing, type FlatRing } from "@/lib/weather/geometry"

/**
 * Smoke and air quality for the Fire & smoke layer. Smoke plumes come from
 * NOAA's Hazard Mapping System (analysts trace smoke on satellite images
 * several times a day); air quality comes from EPA AirNow's reporting areas
 * (current readings plus today's and tomorrow's forecasts). Both are public
 * files that need no key.
 */

/** Smoke density as NOAA rates it, lightest first. */
export const SMOKE_LEVELS = ["light", "medium", "heavy"] as const
export type SmokeLevel = (typeof SMOKE_LEVELS)[number]

export const SMOKE_LEVEL_LABEL: Readonly<Record<SmokeLevel, string>> = { light: "Light", medium: "Medium", heavy: "Heavy" }

/** EPA air quality categories, best first. */
const AIR_CATEGORIES = ["good", "moderate", "sensitive", "unhealthy", "very_unhealthy", "hazardous"] as const
export type AirCategory = (typeof AIR_CATEGORIES)[number]

export const AIR_CATEGORY_LABEL: Readonly<Record<AirCategory, string>> = {
  good: "Good",
  moderate: "Moderate",
  sensitive: "Unhealthy for sensitive groups",
  unhealthy: "Unhealthy",
  very_unhealthy: "Very unhealthy",
  hazardous: "Hazardous",
}

/** Lowest AQI in each category. */
const CATEGORY_FLOOR: Readonly<Record<AirCategory, number>> = { good: 0, moderate: 51, sensitive: 101, unhealthy: 151, very_unhealthy: 201, hazardous: 301 }

export type SmokePlume = {
  readonly density: SmokeLevel
  readonly rings: readonly FlatRing[]
  /** Satellite time window the analyst traced (ISO). */
  readonly startsAt: string | null
  readonly endsAt: string | null
}

type AirNow = {
  readonly aqi: number
  readonly category: AirCategory
  /** "PM2.5", "OZONE", "PM10". */
  readonly parameter: string
  /** Local date (YYYY-MM-DD) and time ("16:00 MST") of the reading. */
  readonly date: string
  readonly time: string
}

type AirForecast = {
  /** Local date (YYYY-MM-DD). */
  readonly date: string
  /** Some agencies forecast only the category. */
  readonly aqi: number | null
  readonly category: AirCategory
  readonly parameter: string
}

/** One AirNow reporting area: a city or region with its reading and forecasts. */
export type AirReading = {
  readonly id: string
  readonly name: string
  readonly state: string
  readonly lon: number
  readonly lat: number
  readonly now: AirNow | null
  readonly forecasts: readonly AirForecast[]
}

type Bounds = { readonly west: number; readonly east: number; readonly south: number; readonly north: number }

/** Data just outside the state still matters to jobs near its border. */
const AREA_PAD_DEG = 0.5
/** Smoke outlines are coarse; about 1 km is plenty. */
const SMOKE_TOLERANCE_DEG = 0.01
const MAX_PLUMES = 250
/** A job uses the nearest reporting area within this distance. */
const AIR_RADIUS_MILES = 40

export function aqiCategory(aqi: number): AirCategory {
  if (aqi >= 301) return "hazardous"
  if (aqi >= 201) return "very_unhealthy"
  if (aqi >= 151) return "unhealthy"
  if (aqi >= 101) return "sensitive"
  if (aqi >= 51) return "moderate"
  return "good"
}

/** A value to compare against the company's AQI limit: the AQI, or the category's lowest AQI when only the category is forecast. */
export function airValue(entry: { readonly aqi: number | null; readonly category: AirCategory }): number {
  return entry.aqi ?? CATEGORY_FLOOR[entry.category]
}

function categoryFromText(text: string): AirCategory | null {
  switch (text.trim().toLowerCase()) {
    case "good": return "good"
    case "moderate": return "moderate"
    case "unhealthy for sensitive groups": return "sensitive"
    case "unhealthy": return "unhealthy"
    case "very unhealthy": return "very_unhealthy"
    case "hazardous": return "hazardous"
    default: return null
  }
}

function within(bounds: Bounds, lon: number, lat: number): boolean {
  return lon >= bounds.west - AREA_PAD_DEG && lon <= bounds.east + AREA_PAD_DEG && lat >= bounds.south - AREA_PAD_DEG && lat <= bounds.north + AREA_PAD_DEG
}

function overlaps(bounds: Bounds, ring: FlatRing): boolean {
  const box = ringBounds(ring)
  return box.east >= bounds.west - AREA_PAD_DEG && box.west <= bounds.east + AREA_PAD_DEG && box.north >= bounds.south - AREA_PAD_DEG && box.south <= bounds.north + AREA_PAD_DEG
}

/** "11/01/26" → "2026-11-01". */
function isoDate(text: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(text.trim())
  return match ? `20${match[3]}-${match[1]}-${match[2]}` : null
}

/** HMS "2026305 1300UTC" (year, day of year, time) → ISO. */
function hmsTime(text: string | undefined): string | null {
  const match = text ? /(\d{4})(\d{3})\s*(\d{2})(\d{2})/.exec(text) : null
  if (!match) return null
  const ms = Date.UTC(Number(match[1]), 0, Number(match[2]), Number(match[3]), Number(match[4]))
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

/** NOAA HMS daily smoke KML → plumes over the area, heaviest drawn last. */
export function parseSmokeKml(kml: string, area: Bounds): SmokePlume[] {
  const plumes: SmokePlume[] = []
  for (const match of kml.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/g)) {
    const body = match[1] ?? ""
    const densityText = /Density:\s*(Light|Medium|Heavy)/i.exec(body)?.[1]?.toLowerCase()
    const density = SMOKE_LEVELS.find((level) => level === densityText)
    if (!density) continue
    const rings: FlatRing[] = []
    for (const coords of body.matchAll(/<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/g)) {
      const points: (readonly [number, number])[] = []
      for (const token of (coords[1] ?? "").trim().split(/\s+/)) {
        const [lon, lat] = token.split(",").map(Number)
        if (lon !== undefined && lat !== undefined && Number.isFinite(lon) && Number.isFinite(lat)) points.push([lon, lat])
      }
      if (points.length < 4) continue
      const ring = simplifyRing(points, SMOKE_TOLERANCE_DEG)
      if (ring.length >= 6 && overlaps(area, ring)) rings.push(ring)
    }
    if (rings.length === 0) continue
    plumes.push({
      density,
      rings,
      startsAt: hmsTime(/Start Time:\s*([^<]+)/.exec(body)?.[1]),
      endsAt: hmsTime(/End Time:\s*([^<]+)/.exec(body)?.[1]),
    })
  }
  const rank = (plume: SmokePlume): number => SMOKE_LEVELS.indexOf(plume.density)
  // Keep the heaviest when there are too many; heaviest last so it draws on top.
  return plumes.sort((a, b) => rank(b) - rank(a)).slice(0, MAX_PLUMES).reverse()
}

/**
 * AirNow reportingarea.dat (pipe-delimited, one line per area, day and
 * pollutant) → readings for the area: the worst current pollutant and the
 * worst forecast per day.
 */
export function parseReportingAreas(text: string, area: Bounds): AirReading[] {
  type Draft = { name: string; state: string; lon: number; lat: number; now: AirNow | null; forecasts: Map<string, AirForecast> }
  const drafts = new Map<string, Draft>()
  for (const line of text.split(/\r?\n/)) {
    const fields = line.split("|")
    if (fields.length < 14) continue
    const [, validDate = "", validTime = "", tz = "", , dataType = "", , name = "", state = "", latText = "", lonText = "", parameter = "", aqiText = "", categoryText = ""] = fields
    if (dataType !== "O" && dataType !== "F") continue
    const lat = Number(latText)
    const lon = Number(lonText)
    const date = isoDate(validDate)
    if (!name || !date || !Number.isFinite(lat) || !Number.isFinite(lon) || !within(area, lon, lat)) continue
    const aqi = aqiText.trim() === "" ? null : Number(aqiText)
    const parsedAqi = aqi !== null && Number.isFinite(aqi) && aqi >= 0 ? Math.round(aqi) : null
    const category = parsedAqi !== null ? aqiCategory(parsedAqi) : categoryFromText(categoryText)
    if (!category) continue
    const id = `${state}:${name}`
    const draft = drafts.get(id) ?? { name, state, lon: roundCoord(lon), lat: roundCoord(lat), now: null, forecasts: new Map<string, AirForecast>() }
    drafts.set(id, draft)
    if (dataType === "O") {
      if (parsedAqi === null) continue
      const later = draft.now !== null && (date > draft.now.date || (date === draft.now.date && validTime > draft.now.time.slice(0, 5)))
      const worse = draft.now !== null && date === draft.now.date && validTime === draft.now.time.slice(0, 5) && parsedAqi > draft.now.aqi
      if (draft.now === null || later || worse) draft.now = { aqi: parsedAqi, category, parameter, date, time: `${validTime} ${tz}`.trim() }
      continue
    }
    const forecast: AirForecast = { date, aqi: parsedAqi, category, parameter }
    const existing = draft.forecasts.get(date)
    if (!existing || airValue(forecast) > airValue(existing)) draft.forecasts.set(date, forecast)
  }
  return [...drafts.entries()].map(([id, draft]) => ({
    id,
    name: draft.name,
    state: draft.state,
    lon: draft.lon,
    lat: draft.lat,
    now: draft.now,
    // Forecasts from the reading's day on; an issue can still carry yesterday's.
    forecasts: [...draft.forecasts.values()]
      .filter((forecast) => draft.now === null || forecast.date >= draft.now.date)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 3),
  }))
}

const str = (record: object, key: string): string | null => {
  const value: unknown = key in record ? Reflect.get(record, key) : null
  return typeof value === "string" && value.trim() ? value : null
}
const num = (record: object, key: string): number | null => {
  const value: unknown = key in record ? Reflect.get(record, key) : null
  return typeof value === "number" && Number.isFinite(value) ? value : null
}
const isObject = (value: unknown): value is object => typeof value === "object" && value !== null
const asCategory = (value: string | null): AirCategory | null => AIR_CATEGORIES.find((category) => category === value) ?? null

function parseJsonArray(text: string | null): unknown[] {
  if (!text) return []
  try {
    const value: unknown = JSON.parse(text)
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function readRings(item: object): FlatRing[] {
  const rings: unknown = "rings" in item ? item.rings : null
  return Array.isArray(rings) ? rings.filter((ring: unknown): ring is number[] => Array.isArray(ring) && ring.every((n: unknown) => typeof n === "number")) : []
}

/** Stored smoke payload → plumes (malformed entries dropped). */
export function readSmoke(text: string | null): SmokePlume[] {
  return parseJsonArray(text).flatMap((item): SmokePlume[] => {
    if (!isObject(item)) return []
    const density = SMOKE_LEVELS.find((level) => level === str(item, "density"))
    const rings = readRings(item)
    if (!density || rings.length === 0) return []
    return [{ density, rings, startsAt: str(item, "startsAt"), endsAt: str(item, "endsAt") }]
  })
}

/** Stored air quality payload → readings (malformed entries dropped). */
export function readAir(text: string | null): AirReading[] {
  return parseJsonArray(text).flatMap((item): AirReading[] => {
    if (!isObject(item)) return []
    const id = str(item, "id")
    const name = str(item, "name")
    const lon = num(item, "lon")
    const lat = num(item, "lat")
    if (!id || !name || lon === null || lat === null) return []
    const rawNow: unknown = "now" in item ? item.now : null
    let now: AirNow | null = null
    if (isObject(rawNow)) {
      const aqi = num(rawNow, "aqi")
      const category = asCategory(str(rawNow, "category"))
      const date = str(rawNow, "date")
      if (aqi !== null && category && date) now = { aqi, category, parameter: str(rawNow, "parameter") ?? "", date, time: str(rawNow, "time") ?? "" }
    }
    const rawForecasts: unknown = "forecasts" in item ? item.forecasts : null
    const forecasts = (Array.isArray(rawForecasts) ? rawForecasts : []).flatMap((entry: unknown): AirForecast[] => {
      if (!isObject(entry)) return []
      const date = str(entry, "date")
      const category = asCategory(str(entry, "category"))
      return date && category ? [{ date, aqi: num(entry, "aqi"), category, parameter: str(entry, "parameter") ?? "" }] : []
    })
    return [{ id, name, state: str(item, "state") ?? "", lon, lat, now, forecasts }]
  })
}

/** The nearest reporting area to a job, when one is close enough to speak for it. */
export function nearestAirReading(readings: readonly AirReading[], lon: number, lat: number): { readonly reading: AirReading; readonly miles: number } | null {
  let best: { reading: AirReading; miles: number } | null = null
  for (const reading of readings) {
    const miles = milesBetween(lon, lat, reading.lon, reading.lat)
    if (miles <= AIR_RADIUS_MILES && (best === null || miles < best.miles)) best = { reading, miles }
  }
  return best
}

/** The densest plume over a point, if any. */
export function smokeAt(plumes: readonly SmokePlume[], lon: number, lat: number): SmokePlume | null {
  let densest: SmokePlume | null = null
  for (const plume of plumes) {
    if (densest !== null && SMOKE_LEVELS.indexOf(plume.density) <= SMOKE_LEVELS.indexOf(densest.density)) continue
    if (plume.rings.some((ring) => pointInRing(lon, lat, ring))) densest = plume
  }
  return densest
}

/** "16:00 MST" → "4 PM MST". */
export function airTimeLabel(time: string): string {
  const match = /^(\d{1,2}):(\d{2})\s*(.*)$/.exec(time.trim())
  if (!match) return time
  const hour = Number(match[1])
  const clock = `${hour % 12 === 0 ? 12 : hour % 12}${match[2] === "00" ? "" : `:${match[2]}`} ${hour < 12 ? "AM" : "PM"}`
  return match[3] ? `${clock} ${match[3]}` : clock
}

export function smokeAtLeast(density: SmokeLevel, level: SmokeLevel): boolean {
  return SMOKE_LEVELS.indexOf(density) >= SMOKE_LEVELS.indexOf(level)
}
