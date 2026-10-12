/**
 * Address geocoding and ground elevation from free public services: US Census
 * geocoder (Nominatim as fallback) and the USGS Elevation Point Query Service
 * (Open-Meteo's 90 m elevation as fallback). Server-side only.
 */

import { resolveTown, townAt } from "@/lib/portfolio-map/model"
import { findNearbyAddress, parseStreetAddress, sameStreet, type StreetAddress } from "@/lib/geo/nearby-address"

export type CoordinatePair = {
  readonly latitude: number
  readonly longitude: number
  readonly label: string | null
  readonly query: string
  /**
   * "address": the address itself; "nearby": the closest recorded number on
   * the same street; "street": somewhere on the street; "town": the town center.
   */
  readonly precision: "address" | "nearby" | "street" | "town"
}

const USER_AGENT = "Compass project management site lookup"
const TIMEOUT_MS = 8000
// Short enough that two servers still fit in the background-work window.
const OVERPASS_TIMEOUT_MS = 10000

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

async function getJson(url: URL, timeoutMs: number = TIMEOUT_MS): Promise<unknown> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

const STATE_NAMES: Readonly<Record<string, string>> = {
  AL: "alabama", AK: "alaska", AZ: "arizona", AR: "arkansas", CA: "california", CO: "colorado",
  CT: "connecticut", DE: "delaware", DC: "district of columbia", FL: "florida", GA: "georgia",
  HI: "hawaii", ID: "idaho", IL: "illinois", IN: "indiana", IA: "iowa", KS: "kansas",
  KY: "kentucky", LA: "louisiana", ME: "maine", MD: "maryland", MA: "massachusetts",
  MI: "michigan", MN: "minnesota", MS: "mississippi", MO: "missouri", MT: "montana",
  NE: "nebraska", NV: "nevada", NH: "new hampshire", NJ: "new jersey", NM: "new mexico",
  NY: "new york", NC: "north carolina", ND: "north dakota", OH: "ohio", OK: "oklahoma",
  OR: "oregon", PA: "pennsylvania", RI: "rhode island", SC: "south carolina", SD: "south dakota",
  TN: "tennessee", TX: "texas", UT: "utah", VT: "vermont", VA: "virginia", WA: "washington",
  WV: "west virginia", WI: "wisconsin", WY: "wyoming",
}

const CODE_BY_NAME: ReadonlyMap<string, string> = new Map(
  Object.entries(STATE_NAMES).map(([code, name]) => [name, code]),
)

// "CT" also means Court at the end of a street, so a bare "… Elm CT" is not read as Connecticut.
const STREET_SUFFIX_CODES: ReadonlySet<string> = new Set(["CT"])

const TRAILING_ZIP = /[\s,]*\b\d{5}(?:-\d{4})?\s*$/
const TRAILING_COUNTRY = /[\s,]*\b(?:usa|us|united states(?: of america)?)\.?\s*$/i

function stateCodeOf(token: string): string | null {
  const cleaned = token.trim().replace(/\.$/, "")
  const upper = cleaned.toUpperCase()
  if (cleaned.length === 2 && STATE_NAMES[upper]) return upper
  if (upper === "COLO") return "CO"
  return CODE_BY_NAME.get(cleaned.toLowerCase()) ?? null
}

/**
 * The state an address names, as a two-letter code, or null when it names
 * none. Only the state position counts: its own comma-separated part, the
 * word or two before a ZIP code, or an upper-case code ending the town part
 * ("Alma CO"). Street words such as "CR" (County Road) or "Colorado" in
 * "Colorado Springs" are not states.
 */
export function addressState(address: string): string | null {
  const hadZip = TRAILING_ZIP.test(address)
  const body = address.replace(TRAILING_COUNTRY, "").replace(TRAILING_ZIP, "").replace(TRAILING_COUNTRY, "").trim()
  const parts = body.split(/[,\n]/).map((part) => part.trim()).filter((part) => part.length > 0)
  const last = parts[parts.length - 1]
  if (!last) return null
  if (parts.length > 1) {
    const whole = stateCodeOf(last)
    if (whole) return whole
  }
  const words = last.split(/\s+/)
  for (const size of [2, 1]) {
    if (words.length <= size) continue
    const tail = words.slice(-size).join(" ")
    const code = stateCodeOf(tail)
    if (!code) continue
    const isCode = size === 1 && tail.replace(/\.$/, "").length === 2
    if (!isCode) return code
    if (hadZip) return code
    if (parts.length > 1 && tail === tail.toUpperCase() && !STREET_SUFFIX_CODES.has(code)) return code
  }
  return null
}

type GeocodePlan = {
  readonly queries: readonly string[]
  /** Matches outside these bounds are ignored. */
  readonly bounds: GeoBounds | null
}

/**
 * Towns are assumed to be in Colorado unless the address names another
 * state: "Alma" is looked up as "Alma, CO", and only Colorado matches count.
 */
export function geocodePlan(address: string): GeocodePlan {
  const trimmed = address.trim()
  if (trimmed.length === 0) return { queries: [], bounds: null }
  const state = addressState(trimmed)
  if (state === "CO") return { queries: [trimmed], bounds: COLORADO_BOUNDS }
  if (state) return { queries: [trimmed], bounds: null }
  const withState = TRAILING_ZIP.test(trimmed)
    ? trimmed.replace(TRAILING_ZIP, (zip) => `, CO ${zip.replace(/^[\s,]+/, "")}`)
    : `${trimmed}, CO`
  return { queries: [withState, trimmed], bounds: COLORADO_BOUNDS }
}

/** A geocoder's answer, with the street it actually matched (for checking). */
type Candidate = {
  readonly coordinates: CoordinatePair
  readonly street: string | null
  readonly hasNumber: boolean
}

/**
 * Geocoders answer loosely: a different street ("Ten Mile Dr" for "Ten Mile
 * Creek Rd"), a highway near the road, or just the town. For an address with
 * a house number, only a numbered match on the same street counts.
 */
export function confirmsAddress(
  target: StreetAddress | null,
  found: { readonly street: string | null; readonly hasNumber: boolean },
): boolean {
  if (!target) return true
  return found.hasNumber && found.street !== null && sameStreet(target.street, found.street)
}

async function geocodeWithCensus(address: string): Promise<Candidate | null> {
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
  const label = textAt(firstMatch, "matchedAddress")
  const matched = label ? parseStreetAddress(label) : null
  return {
    coordinates: { latitude, longitude, label, query: address, precision: "address" },
    street: matched?.street ?? null,
    hasNumber: matched !== null,
  }
}

async function geocodeWithNominatim(address: string, bounds: GeoBounds | null): Promise<Candidate | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search")
  url.searchParams.set("q", address)
  url.searchParams.set("format", "jsonv2")
  url.searchParams.set("limit", "1")
  url.searchParams.set("countrycodes", "us")
  url.searchParams.set("addressdetails", "1")
  if (bounds) {
    url.searchParams.set("viewbox", `${bounds.west},${bounds.north},${bounds.east},${bounds.south}`)
    url.searchParams.set("bounded", "1")
  }
  const parsed = await getJson(url)
  const firstMatch = Array.isArray(parsed) ? parsed.find(isRecord) : undefined
  if (!firstMatch) return null
  const latitude = finiteNumber(firstMatch.lat)
  const longitude = finiteNumber(firstMatch.lon)
  if (latitude === null || longitude === null) return null
  const parts = recordAt(firstMatch, "address")
  return {
    coordinates: { latitude, longitude, label: textAt(firstMatch, "display_name"), query: address, precision: "address" },
    street: parts ? textAt(parts, "road") : null,
    hasNumber: parts ? textAt(parts, "house_number") !== null : false,
  }
}

export type GeoBounds = {
  readonly west: number
  readonly east: number
  readonly south: number
  readonly north: number
}

/** Colorado with a small margin for border jobs. */
export const COLORADO_BOUNDS: GeoBounds = { west: -109.4, east: -101.7, south: 36.7, north: 41.3 }

function within(coordinates: CoordinatePair | null, bounds: GeoBounds | null): CoordinatePair | null {
  if (!coordinates || !bounds) return coordinates
  const { latitude, longitude } = coordinates
  return latitude >= bounds.south && latitude <= bounds.north && longitude >= bounds.west && longitude <= bounds.east
    ? coordinates
    : null
}

export type GeocodeResult =
  | { readonly status: "found"; readonly coordinates: CoordinatePair }
  | { readonly status: "not_found" }
  /** A map service needed for the answer didn't respond; try again later. */
  | { readonly status: "unavailable" }

/**
 * Census first (rooftop/street matches), then Nominatim for rural and partial
 * addresses. Colorado is assumed unless the address names another state; a
 * match outside the expected state (a same-named street elsewhere) is ignored
 * and the next query or service is tried. For a Colorado address neither
 * knows (often a new build), the closest recorded number on the same street
 * near the town stands in, then the street itself.
 */
export async function geocodeProjectAddress(address: string): Promise<GeocodeResult> {
  const plan = geocodePlan(address)
  const target = parseStreetAddress(address)
  const accept = (candidate: Candidate | null): CoordinatePair | null =>
    candidate && confirmsAddress(target, candidate) ? within(candidate.coordinates, plan.bounds) : null
  for (const query of plan.queries) {
    const coordinates = accept(await geocodeWithCensus(query))
    if (coordinates) return { status: "found", coordinates }
  }
  for (const query of plan.queries) {
    const coordinates = accept(await geocodeWithNominatim(query, plan.bounds))
    if (coordinates) return { status: "found", coordinates }
  }
  if (!plan.bounds) return { status: "not_found" }
  const town = resolveTown({ publicLocationCity: null, address, name: "" })
  if (!town) return { status: "not_found" }
  const nearby = await findNearbyAddress(
    address,
    {
      center: { latitude: town.lat, longitude: town.lon },
      accept: (latitude, longitude) => {
        const other = townAt(latitude, longitude)
        return other === null || other === town.town
      },
    },
    (url) => getJson(url, OVERPASS_TIMEOUT_MS),
  )
  if (nearby.status !== "found") return nearby.status === "unavailable" ? nearby : { status: "not_found" }
  const { match } = nearby
  const coordinates = within(
    { latitude: match.latitude, longitude: match.longitude, label: match.label, query: address, precision: match.precision },
    plan.bounds,
  )
  return coordinates ? { status: "found", coordinates } : { status: "not_found" }
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
