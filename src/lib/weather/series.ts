/**
 * A forecast grid cell's next days in 3-hour steps, parsed from the National
 * Weather Service gridpoint data. Stored per cell and sent to the map.
 */
export const STEP_HOURS = 3
export const STEP_MS = STEP_HOURS * 60 * 60 * 1000
/** Seven days of 3-hour steps. */
export const SERIES_STEPS = 56

export type CellSeries = {
  /** ISO time of the first step (a 3-hour boundary, UTC). */
  readonly start: string
  readonly tempMinF: readonly (number | null)[]
  readonly tempMaxF: readonly (number | null)[]
  /** Liquid-equivalent precipitation in the step, inches. */
  readonly precipIn: readonly (number | null)[]
  /** Snowfall in the step, inches. */
  readonly snowIn: readonly (number | null)[]
  readonly gustMph: readonly (number | null)[]
  /** Wind direction (degrees, where it blows from) at the step's strongest gust. */
  readonly windDir: readonly (number | null)[]
}

const HOUR_MS = 60 * 60 * 1000

/** "PT2H", "P1D", "P1DT6H" → hours (at least 1). */
export function durationHours(value: string): number {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(value)
  if (!match) return 1
  const hours = Number(match[1] ?? 0) * 24 + Number(match[2] ?? 0) + Number(match[3] ?? 0) / 60
  return Math.max(1, Math.round(hours))
}

type HourValues = Map<number, number>

/**
 * Spreads one gridpoint property over hours. Amounts (precipitation, snow)
 * are divided across the interval; levels (temperature, wind) repeat.
 */
function hourlyValues(property: unknown, mode: "level" | "amount"): HourValues {
  const hours: HourValues = new Map()
  if (typeof property !== "object" || property === null || !("values" in property)) return hours
  const values = property.values
  if (!Array.isArray(values)) return hours
  for (const entry of values) {
    if (typeof entry !== "object" || entry === null) continue
    const validTime = "validTime" in entry ? entry.validTime : null
    const value = "value" in entry ? entry.value : null
    if (typeof validTime !== "string" || typeof value !== "number" || !Number.isFinite(value)) continue
    const [startText, durationText] = validTime.split("/")
    const startMs = Date.parse(startText ?? "")
    if (!Number.isFinite(startMs)) continue
    const count = durationHours(durationText ?? "PT1H")
    const each = mode === "amount" ? value / count : value
    const first = Math.floor(startMs / HOUR_MS) * HOUR_MS
    for (let i = 0; i < count; i += 1) hours.set(first + i * HOUR_MS, each)
  }
  return hours
}

const round = (value: number, places: number): number => {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

/** The 3-hour boundary at or before a time. */
export function stepStart(ms: number): number {
  return Math.floor(ms / STEP_MS) * STEP_MS
}

/** Gridpoint `properties` → a cell series starting at the step containing `nowMs`. */
export function parseGridSeries(properties: unknown, nowMs: number): CellSeries | null {
  if (typeof properties !== "object" || properties === null) return null
  const get = (key: string): unknown => (key in properties ? Reflect.get(properties, key) : null)
  const temperature = hourlyValues(get("temperature"), "level")
  if (temperature.size === 0) return null
  const precipitation = hourlyValues(get("quantitativePrecipitation"), "amount")
  const snowfall = hourlyValues(get("snowfallAmount"), "amount")
  const gusts = hourlyValues(get("windGust"), "level")
  const direction = hourlyValues(get("windDirection"), "level")

  const start = stepStart(nowMs)
  const tempMinF: (number | null)[] = []
  const tempMaxF: (number | null)[] = []
  const precipIn: (number | null)[] = []
  const snowIn: (number | null)[] = []
  const gustMph: (number | null)[] = []
  const windDir: (number | null)[] = []
  for (let step = 0; step < SERIES_STEPS; step += 1) {
    let min: number | null = null
    let max: number | null = null
    let rain: number | null = null
    let snow: number | null = null
    let gust: number | null = null
    let dir: number | null = null
    for (let h = 0; h < STEP_HOURS; h += 1) {
      const hour = start + step * STEP_MS + h * HOUR_MS
      const celsius = temperature.get(hour)
      if (celsius !== undefined) {
        const f = (celsius * 9) / 5 + 32
        min = min === null ? f : Math.min(min, f)
        max = max === null ? f : Math.max(max, f)
      }
      const mm = precipitation.get(hour)
      if (mm !== undefined) rain = (rain ?? 0) + mm / 25.4
      const snowMm = snowfall.get(hour)
      if (snowMm !== undefined) snow = (snow ?? 0) + snowMm / 25.4
      const kmh = gusts.get(hour)
      if (kmh !== undefined && (gust === null || kmh / 1.609344 > gust)) {
        gust = kmh / 1.609344
        dir = direction.get(hour) ?? dir
      }
      if (dir === null) dir = direction.get(hour) ?? null
    }
    tempMinF.push(min === null ? null : Math.round(min))
    tempMaxF.push(max === null ? null : Math.round(max))
    precipIn.push(rain === null ? null : round(rain, 2))
    snowIn.push(snow === null ? null : round(snow, 1))
    gustMph.push(gust === null ? null : Math.round(gust))
    windDir.push(dir === null ? null : Math.round(dir / 10) * 10)
  }
  if (tempMaxF.every((value) => value === null)) return null
  return { start: new Date(start).toISOString(), tempMinF, tempMaxF, precipIn, snowIn, gustMph, windDir }
}

/** Parses a stored series; null when missing or malformed. */
export function readCellSeries(text: string | null): CellSeries | null {
  if (!text) return null
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value !== "object" || value === null) return null
    const start = "start" in value ? value.start : null
    if (typeof start !== "string") return null
    const list = (key: string): (number | null)[] | null => {
      const raw: unknown = key in value ? Reflect.get(value, key) : null
      return Array.isArray(raw) ? raw.map((item: unknown) => (typeof item === "number" && Number.isFinite(item) ? item : null)) : null
    }
    const tempMinF = list("tempMinF")
    const tempMaxF = list("tempMaxF")
    const precipIn = list("precipIn")
    const snowIn = list("snowIn")
    const gustMph = list("gustMph")
    const windDir = list("windDir")
    if (!tempMinF || !tempMaxF || !precipIn || !snowIn || !gustMph || !windDir) return null
    return { start, tempMinF, tempMaxF, precipIn, snowIn, gustMph, windDir }
  } catch {
    return null
  }
}

/**
 * The same series re-based to start at `startMs` (a step boundary), keeping
 * `steps` steps; steps before the stored start or past its end are null.
 */
export function alignSeries(series: CellSeries, startMs: number, steps: number): CellSeries {
  const offset = Math.round((startMs - Date.parse(series.start)) / STEP_MS)
  const pick = (values: readonly (number | null)[]): (number | null)[] =>
    Array.from({ length: steps }, (_, i) => values[i + offset] ?? null)
  return {
    start: new Date(startMs).toISOString(),
    tempMinF: pick(series.tempMinF),
    tempMaxF: pick(series.tempMaxF),
    precipIn: pick(series.precipIn),
    snowIn: pick(series.snowIn),
    gustMph: pick(series.gustMph),
    windDir: pick(series.windDir),
  }
}
