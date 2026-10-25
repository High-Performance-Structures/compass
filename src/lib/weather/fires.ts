import { outerRings, ringBounds, roundCoord, simplifyRing, type FlatRing } from "@/lib/weather/geometry"

/** An active wildfire: its reported point and, when mapped, its outline. */
export type ActiveFire = {
  readonly id: string
  readonly name: string
  readonly acres: number | null
  readonly containedPercent: number | null
  readonly discoveredAt: string | null
  readonly updatedAt: string | null
  readonly lon: number
  readonly lat: number
  readonly rings: readonly FlatRing[]
}

/** Outline tolerance for fire perimeters: about 250 m. */
export const FIRE_TOLERANCE_DEG = 0.0025
/** Pieces of an outline smaller than this (degrees, about 400 m) are left off the map. */
const MIN_RING_SPAN_DEG = 0.004

function visibleRing(ring: FlatRing): boolean {
  if (ring.length < 8) return false
  const bounds = ringBounds(ring)
  return bounds.east - bounds.west >= MIN_RING_SPAN_DEG || bounds.north - bounds.south >= MIN_RING_SPAN_DEG
}

const num = (record: object, key: string): number | null => {
  const value: unknown = key in record ? Reflect.get(record, key) : null
  return typeof value === "number" && Number.isFinite(value) ? value : null
}
const str = (record: object, key: string): string | null => {
  const value: unknown = key in record ? Reflect.get(record, key) : null
  return typeof value === "string" && value.trim() ? value.trim() : null
}
const isoFromEpoch = (value: number | null): string | null => (value === null ? null : new Date(value).toISOString())
const normalizeId = (value: string | null): string | null => (value ? value.replace(/[{}]/g, "").toUpperCase() : null)

function features(value: unknown): object[] {
  if (typeof value !== "object" || value === null || !("features" in value) || !Array.isArray(value.features)) return []
  return value.features.filter((feature: unknown): feature is object => typeof feature === "object" && feature !== null)
}

function propertiesOf(feature: object): object | null {
  const properties: unknown = "properties" in feature ? feature.properties : null
  return typeof properties === "object" && properties !== null ? properties : null
}

/** Title case for names reported in capitals ("COOLEY" → "Cooley"). */
export function fireName(raw: string): string {
  const name = raw.trim()
  if (name !== name.toUpperCase()) return name
  return name.toLowerCase().replace(/\b([a-z])/g, (letter) => letter.toUpperCase())
}

/**
 * WFIGS incident points and perimeters (GeoJSON) → active fires. Perimeters
 * join their incident by IRWIN id; a perimeter without a point still shows.
 */
export function parseFires(incidents: unknown, perimeters: unknown): ActiveFire[] {
  const outlines = new Map<string, { name: string | null; rings: FlatRing[]; acres: number | null; contained: number | null; updated: number | null }>()
  for (const feature of features(perimeters)) {
    const properties = propertiesOf(feature)
    if (!properties) continue
    const id = normalizeId(str(properties, "poly_IRWINID") ?? str(properties, "attr_IrwinID"))
    if (!id) continue
    const geometry: unknown = "geometry" in feature ? feature.geometry : null
    const rings = outerRings(geometry).map((ring) => simplifyRing(ring, FIRE_TOLERANCE_DEG)).filter(visibleRing)
    if (rings.length === 0) continue
    const existing = outlines.get(id)
    outlines.set(id, {
      name: str(properties, "poly_IncidentName") ?? existing?.name ?? null,
      rings: [...(existing?.rings ?? []), ...rings],
      acres: num(properties, "attr_IncidentSize") ?? num(properties, "poly_GISAcres"),
      contained: num(properties, "attr_PercentContained"),
      updated: num(properties, "poly_DateCurrent"),
    })
  }

  const fires: ActiveFire[] = []
  const seen = new Set<string>()
  for (const feature of features(incidents)) {
    const properties = propertiesOf(feature)
    if (!properties) continue
    const id = normalizeId(str(properties, "IrwinID"))
    const geometry: unknown = "geometry" in feature ? feature.geometry : null
    const coordinates: unknown = typeof geometry === "object" && geometry !== null && "coordinates" in geometry ? geometry.coordinates : null
    if (!id || !Array.isArray(coordinates)) continue
    const [lon, lat] = coordinates
    if (typeof lon !== "number" || typeof lat !== "number") continue
    const outline = outlines.get(id)
    seen.add(id)
    fires.push({
      id,
      name: fireName(str(properties, "IncidentName") ?? outline?.name ?? "Unnamed fire"),
      acres: num(properties, "IncidentSize") ?? outline?.acres ?? null,
      containedPercent: num(properties, "PercentContained") ?? outline?.contained ?? null,
      discoveredAt: isoFromEpoch(num(properties, "FireDiscoveryDateTime")),
      updatedAt: isoFromEpoch(num(properties, "ModifiedOnDateTime_dt") ?? outline?.updated ?? null),
      lon: roundCoord(lon),
      lat: roundCoord(lat),
      rings: outline?.rings ?? [],
    })
  }
  for (const [id, outline] of outlines) {
    if (seen.has(id) || (outline.contained !== null && outline.contained >= 100)) continue
    const first = outline.rings[0] ?? []
    if (first.length < 2) continue
    fires.push({
      id,
      name: fireName(outline.name ?? "Unnamed fire"),
      acres: outline.acres,
      containedPercent: outline.contained,
      discoveredAt: null,
      updatedAt: isoFromEpoch(outline.updated),
      lon: first[0] ?? 0,
      lat: first[1] ?? 0,
      rings: outline.rings,
    })
  }
  return fires
}

/** Stored fires payload → fires (malformed entries dropped). */
export function readFires(textValue: string | null): ActiveFire[] {
  if (!textValue) return []
  try {
    const value: unknown = JSON.parse(textValue)
    if (!Array.isArray(value)) return []
    return value.flatMap((item: unknown): ActiveFire[] => {
      if (typeof item !== "object" || item === null) return []
      const id = str(item, "id")
      const name = str(item, "name")
      const lon = num(item, "lon")
      const lat = num(item, "lat")
      if (!id || !name || lon === null || lat === null) return []
      const rings: unknown = "rings" in item ? item.rings : null
      return [{
        id,
        name,
        acres: num(item, "acres"),
        containedPercent: num(item, "containedPercent"),
        discoveredAt: str(item, "discoveredAt"),
        updatedAt: str(item, "updatedAt"),
        lon,
        lat,
        rings: Array.isArray(rings) ? rings.filter((ring: unknown): ring is number[] => Array.isArray(ring) && ring.every((n: unknown) => typeof n === "number")) : [],
      }]
    })
  } catch {
    return []
  }
}
