import { STATE_BOUNDS } from "@/lib/portfolio-map/state-bounds.generated"
import { DEFAULT_MAP_STATE, MAP_STATES, mapStateName, type MapStateCode } from "@/lib/portfolio-map/states"

/**
 * Map areas weather and fire data are gathered for: one per state, matching the
 * state each company picks for its map (Settings › Portfolio map › Map state).
 */
export type WeatherArea = {
  readonly key: string
  readonly label: string
  /** Two-letter state codes, for NWS warnings by area. */
  readonly states: readonly string[]
  readonly west: number
  readonly east: number
  readonly south: number
  readonly north: number
}

export const WEATHER_AREAS: readonly WeatherArea[] = MAP_STATES.flatMap((state): WeatherArea[] => {
  const bounds = STATE_BOUNDS[state.code]
  return bounds ? [{ key: state.code, label: state.name, states: [state.code], ...bounds }] : []
})

export const DEFAULT_WEATHER_AREA: WeatherArea = WEATHER_AREAS.find((area) => area.key === DEFAULT_MAP_STATE) ?? {
  key: "CO", label: "Colorado", states: ["CO"], west: -109.05, east: -102.05, south: 37, north: 41,
}

export function weatherArea(key: string): WeatherArea | null {
  return WEATHER_AREAS.find((area) => area.key === key) ?? null
}

/** The weather area for a company's map state (Colorado's if that state has no map yet). */
export function weatherAreaForState(state: MapStateCode): WeatherArea {
  return weatherArea(state) ?? { ...DEFAULT_WEATHER_AREA, label: mapStateName(DEFAULT_MAP_STATE) }
}

// About one sample every 60 km; bigger states space them out so each map gets a similar
// number of samples (and the same look on screen) without outgrowing the refresh budget.
const SAMPLE_KM = 60
const MAX_SAMPLES = 80

/** Sample grid size for an area. */
export function areaGrid(area: WeatherArea): { readonly cols: number; readonly rows: number; readonly lonStep: number; readonly latStep: number } {
  const midLat = (area.south + area.north) / 2
  const widthKm = (area.east - area.west) * 111.32 * Math.cos((midLat * Math.PI) / 180)
  const heightKm = (area.north - area.south) * 110.57
  const spacingKm = Math.max(SAMPLE_KM, Math.sqrt((widthKm * heightKm) / MAX_SAMPLES))
  const cols = Math.max(2, Math.round(widthKm / spacingKm))
  const rows = Math.max(2, Math.round(heightKm / spacingKm))
  return { cols, rows, lonStep: (area.east - area.west) / cols, latStep: (area.north - area.south) / rows }
}

/** The area's sample points, one per grid square's center. */
export function areaSamplePoints(area: WeatherArea): { readonly lat: number; readonly lon: number }[] {
  const { cols, rows } = areaGrid(area)
  const points: { lat: number; lon: number }[] = []
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      points.push({
        lat: area.north - ((row + 0.5) * (area.north - area.south)) / rows,
        lon: area.west + ((col + 0.5) * (area.east - area.west)) / cols,
      })
    }
  }
  return points
}

/** Rounded "lat,lon" key (about 1 km), shared by job sites and samples. */
export function weatherPointKey(lat: number, lon: number): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`
}
