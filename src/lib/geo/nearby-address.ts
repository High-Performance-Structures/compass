/**
 * Fallback for addresses the geocoders don't know yet (often new rural
 * builds): find the closest recorded house number on the same street near the
 * town, or failing that the street itself, from OpenStreetMap via Overpass.
 * Works for any "<number> <street>, <town>" address; street spellings are
 * normalized so "County Rd 12", "CR 12" and "GCR 12" are the same street.
 */

export type StreetAddress = {
  readonly houseNumber: number
  readonly street: string
}

export type NearbyMatch = {
  readonly latitude: number
  readonly longitude: number
  /** "nearby": a recorded number on the same street; "street": the street itself. */
  readonly precision: "nearby" | "street"
  /** What was used, e.g. "Near 1062 CR 8952" or "On CR 8952 (number not found)". */
  readonly label: string
}

export type SearchCenter = {
  readonly latitude: number
  readonly longitude: number
}

const WORD_FORMS: Readonly<Record<string, string>> = {
  rd: "road", st: "street", dr: "drive", ln: "lane", ct: "court", ave: "avenue", av: "avenue",
  cir: "circle", blvd: "boulevard", hwy: "highway", pl: "place", trl: "trail", pkwy: "parkway",
  ter: "terrace", pt: "point", mtn: "mountain", n: "north", s: "south", e: "east", w: "west",
}

const GENERIC_WORDS: ReadonlySet<string> = new Set([
  "cr", "road", "street", "drive", "lane", "court", "avenue", "circle", "boulevard", "highway",
  "place", "trail", "parkway", "terrace", "way", "north", "south", "east", "west", "us", "state",
])

/** Lower-case street name with common abbreviations spelled out and county roads as "cr N". */
export function normalizeStreet(value: string): string {
  const words = value
    .toLowerCase()
    .replace(/[.#']/g, "")
    .split(/[\s-]+/)
    .filter((word) => word.length > 0)
    .map((word) => WORD_FORMS[word] ?? word)
  return words
    .join(" ")
    .replace(/\b(?:grand |[a-z]+ )?(?:county road|co road|gcr|cr)\b/g, "cr")
    .replace(/\bcr cr\b/g, "cr")
    .replace(/^(?:us|state|colorado|co|sh) (?=\d)/, "highway ")
    .replace(/\b(?:us|state|colorado|co|sh) highway\b/g, "highway")
    .replace(/\bsh\b/g, "highway")
    .trim()
}

/** The house number and street from the first part of an address, or null without a number. */
export function parseStreetAddress(address: string): StreetAddress | null {
  const first = address.split(/[,\n]/)[0]?.trim() ?? ""
  const match = /^(\d+)[a-z]?\s+(.+)$/i.exec(first)
  if (!match?.[1] || !match[2]) return null
  const street = match[2].replace(/\s+(?:unit|apt|ste|suite|bldg|lot|#)\s*\S+$/i, "").trim()
  return street ? { houseNumber: Number(match[1]), street } : null
}

/** The most specific word of the street, used to narrow the map query. */
export function streetKeyword(street: string): string | null {
  const words = normalizeStreet(street).split(" ").filter((word) => !GENERIC_WORDS.has(word))
  const sorted = [...words].sort((a, b) => b.length - a.length)
  const keyword = sorted[0]
  return keyword && /^[a-z0-9]+$/.test(keyword) ? keyword : null
}

const DIRECTIONS = /\b(?:north|south|east|west)\b/g

function withoutDirections(normalized: string): string {
  return normalized.replace(DIRECTIONS, " ").replace(/\s+/g, " ").trim()
}

/**
 * Same street after normalizing. An address written without a direction
 * ("Main St") also matches the street with one ("North Main Street"); one
 * written with a direction must match it.
 */
export function sameStreet(wanted: string, recorded: string): boolean {
  const a = normalizeStreet(wanted)
  const b = normalizeStreet(recorded)
  if (a === b) return true
  return withoutDirections(a) === a && a.length > 0 && withoutDirections(b) === a
}

export type MapFeature = {
  readonly tags: Readonly<Record<string, string>>
  readonly latitude: number
  readonly longitude: number
}

function leadingNumber(value: string): number | null {
  const match = /^\d+/.exec(value.trim())
  return match ? Number(match[0]) : null
}

function streetNames(feature: MapFeature): readonly string[] {
  const { tags } = feature
  return [tags.name, tags.alt_name, ...(tags.ref ?? "").split(";")]
    .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
}

export type NearbyOptions = {
  /** The mailing town's center; the street fallback uses the segment nearest it. */
  readonly center: SearchCenter
  /** False for a point that is really somewhere else (inside another town). */
  readonly accept: (latitude: number, longitude: number) => boolean
}

function squaredDistance(feature: MapFeature, center: SearchCenter): number {
  const lonScale = Math.cos((center.latitude * Math.PI) / 180)
  return (feature.latitude - center.latitude) ** 2 + ((feature.longitude - center.longitude) * lonScale) ** 2
}

/**
 * Pick the closest recorded house number on the same street; without one,
 * the matching street segment nearest the town. Pure, so it can be tested
 * without the network.
 */
export function pickNearby(
  target: StreetAddress,
  allFeatures: readonly MapFeature[],
  options: NearbyOptions,
): NearbyMatch | null {
  const features = allFeatures.filter((feature) => options.accept(feature.latitude, feature.longitude))
  let best: { readonly feature: MapFeature; readonly number: number; readonly gap: number } | null = null
  for (const feature of features) {
    const recordedStreet = feature.tags["addr:street"]
    const recordedNumber = feature.tags["addr:housenumber"]
    if (!recordedStreet || !recordedNumber || !sameStreet(target.street, recordedStreet)) continue
    const number = leadingNumber(recordedNumber)
    if (number === null) continue
    const gap = Math.abs(number - target.houseNumber)
    if (!best || gap < best.gap || (gap === best.gap && number < best.number)) best = { feature, number, gap }
  }
  if (best) {
    return {
      latitude: best.feature.latitude,
      longitude: best.feature.longitude,
      precision: "nearby",
      label: `Near ${best.feature.tags["addr:housenumber"]} ${best.feature.tags["addr:street"]}`,
    }
  }
  const segments = features
    .filter((feature) => feature.tags.highway !== undefined && streetNames(feature).some((name) => sameStreet(target.street, name)))
    .sort((a, b) => squaredDistance(a, options.center) - squaredDistance(b, options.center))
  const nearest = segments[0]
  if (!nearest) return null
  return {
    latitude: nearest.latitude,
    longitude: nearest.longitude,
    precision: "street",
    label: `On ${target.street} (number not found)`,
  }
}

// About 16 km north–south and 17 km east–west of the town: rural addresses
// are often well outside the town they are mailed to.
const SEARCH_HALF_LAT = 0.15
const SEARCH_HALF_LON = 0.2

export function overpassQuery(keyword: string, center: SearchCenter): string {
  const box = [
    center.latitude - SEARCH_HALF_LAT,
    center.longitude - SEARCH_HALF_LON,
    center.latitude + SEARCH_HALF_LAT,
    center.longitude + SEARCH_HALF_LON,
  ]
    .map((value) => value.toFixed(4))
    .join(",")
  return [
    "[out:json][timeout:20];",
    "(",
    `nwr["addr:housenumber"]["addr:street"~"${keyword}",i](${box});`,
    `way["highway"]["name"~"${keyword}",i](${box});`,
    `way["highway"]["ref"~"${keyword}",i](${box});`,
    ");",
    "out tags center 300;",
  ].join("")
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function stringTags(value: unknown): Readonly<Record<string, string>> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, tag]): [string, string][] => (typeof tag === "string" ? [[key, tag]] : [])),
  )
}

/** Overpass elements as features; ways and relations use their center point. */
export function parseOverpass(value: unknown): readonly MapFeature[] {
  const elements = isRecord(value) && Array.isArray(value.elements) ? value.elements : []
  return elements.flatMap((element): MapFeature[] => {
    if (!isRecord(element)) return []
    const center = isRecord(element.center) ? element.center : element
    const latitude = finite(center.lat)
    const longitude = finite(center.lon)
    return latitude === null || longitude === null ? [] : [{ tags: stringTags(element.tags), latitude, longitude }]
  })
}

// The public Overpass servers are often busy; the second is a mirror.
const OVERPASS_SERVERS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
] as const

export type NearbyResult =
  | { readonly status: "found"; readonly match: NearbyMatch }
  | { readonly status: "none" }
  /** No map server answered; try again later rather than recording "not found". */
  | { readonly status: "unavailable" }

function isOverpassResponse(value: unknown): boolean {
  return isRecord(value) && Array.isArray(value.elements)
}

/** Closest recorded number (or the street) near the town. */
export async function findNearbyAddress(
  address: string,
  options: NearbyOptions,
  getJson: (url: URL) => Promise<unknown>,
): Promise<NearbyResult> {
  const target = parseStreetAddress(address)
  if (!target) return { status: "none" }
  const keyword = streetKeyword(target.street)
  if (!keyword) return { status: "none" }
  for (const server of OVERPASS_SERVERS) {
    const url = new URL(server)
    url.searchParams.set("data", overpassQuery(keyword, options.center))
    const response = await getJson(url)
    if (!isOverpassResponse(response)) continue
    const match = pickNearby(target, parseOverpass(response), options)
    return match ? { status: "found", match } : { status: "none" }
  }
  return { status: "unavailable" }
}
