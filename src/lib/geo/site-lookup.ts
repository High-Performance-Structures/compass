/**
 * Address geocoding and ground elevation from free public services: US Census
 * geocoder (Nominatim as fallback) and the USGS Elevation Point Query Service
 * (Open-Meteo's 90 m elevation as fallback). Server-side only.
 */

export type CoordinatePair = {
  readonly latitude: number
  readonly longitude: number
  readonly label: string | null
  readonly query: string
}

const USER_AGENT = "Compass project management site lookup"
const TIMEOUT_MS = 8000

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function recordAt(value: Readonly<Record<string, unknown>>, key: string): Readonly<Record<string, unknown>> | null {
  const found = value[key]
  return isRecord(found) ? found : null
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === "string" ? Number(value) : value
  return typeof number === "number" && Number.isFinite(number) ? number : null
}

function textAt(value: Readonly<Record<string, unknown>>, key: string): string | null {
  const found = value[key]
  return typeof found === "string" && found.trim().length > 0 ? found : null
}

async function getJson(url: URL): Promise<unknown> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

function addressLooksStateQualified(value: string): boolean {
  return /\b[A-Z]{2}\b/.test(value) || /\bColorado\b/i.test(value)
}

function geocodeQueries(address: string): readonly string[] {
  const trimmed = address.trim()
  if (trimmed.length === 0) return []
  if (addressLooksStateQualified(trimmed)) return [trimmed]
  return [trimmed, `${trimmed}, Colorado`]
}

async function geocodeWithCensus(address: string): Promise<CoordinatePair | null> {
  const url = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress")
  url.searchParams.set("address", address)
  url.searchParams.set("benchmark", "Public_AR_Current")
  url.searchParams.set("format", "json")
  const parsed = await getJson(url)
  if (!isRecord(parsed)) return null
  const result = recordAt(parsed, "result")
  const matches = result?.addressMatches
  const firstMatch = Array.isArray(matches) ? matches.find(isRecord) : undefined
  if (!firstMatch) return null
  const coordinates = recordAt(firstMatch, "coordinates")
  const longitude = finiteNumber(coordinates?.x)
  const latitude = finiteNumber(coordinates?.y)
  if (latitude === null || longitude === null) return null
  return { latitude, longitude, label: textAt(firstMatch, "matchedAddress"), query: address }
}

async function geocodeWithNominatim(address: string): Promise<CoordinatePair | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search")
  url.searchParams.set("q", address)
  url.searchParams.set("format", "jsonv2")
  url.searchParams.set("limit", "1")
  url.searchParams.set("countrycodes", "us")
  const parsed = await getJson(url)
  const firstMatch = Array.isArray(parsed) ? parsed.find(isRecord) : undefined
  if (!firstMatch) return null
  const latitude = finiteNumber(firstMatch.lat)
  const longitude = finiteNumber(firstMatch.lon)
  if (latitude === null || longitude === null) return null
  return { latitude, longitude, label: textAt(firstMatch, "display_name"), query: address }
}

export type GeoBounds = {
  readonly west: number
  readonly east: number
  readonly south: number
  readonly north: number
}

/** Colorado with a small margin for border jobs. */
export const COLORADO_BOUNDS: GeoBounds = { west: -109.4, east: -101.7, south: 36.7, north: 41.3 }

function within(coordinates: CoordinatePair | null, bounds: GeoBounds | undefined): CoordinatePair | null {
  if (!coordinates || !bounds) return coordinates
  const { latitude, longitude } = coordinates
  return latitude >= bounds.south && latitude <= bounds.north && longitude >= bounds.west && longitude <= bounds.east
    ? coordinates
    : null
}

/**
 * Census first (rooftop/street matches), then Nominatim for rural and partial
 * addresses. With `bounds`, a match elsewhere (a same-named street in another
 * state) is ignored and the next service is tried.
 */
export async function geocodeProjectAddress(address: string, bounds?: GeoBounds): Promise<CoordinatePair | null> {
  for (const query of geocodeQueries(address)) {
    const coordinates = within(await geocodeWithCensus(query), bounds)
    if (coordinates) return coordinates
  }
  for (const query of geocodeQueries(address)) {
    const coordinates = within(await geocodeWithNominatim(query), bounds)
    if (coordinates) return coordinates
  }
  return null
}

// USGS returns a large negative sentinel when it has no data for a point.
function plausibleFeet(value: number | null): number | null {
  return value !== null && value > -1000 && value < 30000 ? Math.round(value) : null
}

/** Ground elevation in feet at a point, or null when no service answers. */
export async function fetchElevationFeet(latitude: number, longitude: number): Promise<number | null> {
  const usgs = new URL("https://epqs.nationalmap.gov/v1/json")
  usgs.searchParams.set("x", String(longitude))
  usgs.searchParams.set("y", String(latitude))
  usgs.searchParams.set("units", "Feet")
  usgs.searchParams.set("wkid", "4326")
  usgs.searchParams.set("includeDate", "false")
  const fromUsgs = await getJson(usgs)
  const usgsFeet = plausibleFeet(isRecord(fromUsgs) ? finiteNumber(fromUsgs.value) : null)
  if (usgsFeet !== null) return usgsFeet

  const meteo = new URL("https://api.open-meteo.com/v1/elevation")
  meteo.searchParams.set("latitude", String(latitude))
  meteo.searchParams.set("longitude", String(longitude))
  const fromMeteo = await getJson(meteo)
  const meters = isRecord(fromMeteo) && Array.isArray(fromMeteo.elevation) ? finiteNumber(fromMeteo.elevation[0]) : null
  return plausibleFeet(meters === null ? null : meters * 3.28084)
}
