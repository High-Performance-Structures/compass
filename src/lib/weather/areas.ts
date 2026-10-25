/**
 * Map areas weather and fire data are gathered for. The portfolio map shows
 * Colorado today; when companies pick their states (Settings › Map coverage)
 * each picked state becomes an area here.
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

export const WEATHER_AREAS: readonly WeatherArea[] = [
  { key: "CO", label: "Colorado", states: ["CO"], west: -109.05, east: -102.05, south: 37, north: 41 },
]

export const DEFAULT_WEATHER_AREA: WeatherArea = WEATHER_AREAS[0] ?? {
  key: "CO", label: "Colorado", states: ["CO"], west: -109.05, east: -102.05, south: 37, north: 41,
}

export function weatherArea(key: string): WeatherArea | null {
  return WEATHER_AREAS.find((area) => area.key === key) ?? null
}

/** Sample grid size for an area: about one point every 60 km. */
export function areaGrid(area: WeatherArea): { readonly cols: number; readonly rows: number; readonly lonStep: number; readonly latStep: number } {
  const midLat = (area.south + area.north) / 2
  const widthKm = (area.east - area.west) * 111.32 * Math.cos((midLat * Math.PI) / 180)
  const heightKm = (area.north - area.south) * 110.57
  const cols = Math.max(2, Math.round(widthKm / 60))
  const rows = Math.max(2, Math.round(heightKm / 60))
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
