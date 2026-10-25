/**
 * Small geometry helpers for weather and fire outlines. A ring is a flat
 * [lon, lat, lon, lat, …] list, rounded so payloads stay small.
 */
export type FlatRing = readonly number[]

const KM_PER_DEG_LAT = 110.57

/** Rounds to 3 decimals (about 100 m), plenty for a statewide map. */
export function roundCoord(value: number): number {
  return Math.round(value * 1000) / 1000
}

function perpendicularDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Douglas–Peucker simplification of [lon, lat] pairs; tolerance in degrees. */
export function simplifyRing(points: readonly (readonly [number, number])[], tolerance: number): FlatRing {
  if (points.length <= 4) return points.flatMap(([lon, lat]) => [roundCoord(lon), roundCoord(lat)])
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length > 0) {
    const range = stack.pop()
    if (!range) break
    const [start, end] = range
    const a = points[start]
    const b = points[end]
    if (!a || !b) continue
    let maxDistance = 0
    let index = -1
    for (let i = start + 1; i < end; i += 1) {
      const p = points[i]
      if (!p) continue
      const distance = perpendicularDistance(p[0], p[1], a[0], a[1], b[0], b[1])
      if (distance > maxDistance) {
        maxDistance = distance
        index = i
      }
    }
    if (index >= 0 && maxDistance > tolerance) {
      keep[index] = 1
      stack.push([start, index], [index, end])
    }
  }
  const flat: number[] = []
  points.forEach(([lon, lat], i) => {
    if (keep[i]) flat.push(roundCoord(lon), roundCoord(lat))
  })
  return flat
}

/** GeoJSON Polygon / MultiPolygon coordinates → outer rings as [lon, lat] pairs. */
export function outerRings(geometry: unknown): (readonly [number, number])[][] {
  if (typeof geometry !== "object" || geometry === null) return []
  const type = "type" in geometry ? geometry.type : null
  const coordinates = "coordinates" in geometry ? geometry.coordinates : null
  if (!Array.isArray(coordinates)) return []
  const polygons = type === "Polygon" ? [coordinates] : type === "MultiPolygon" ? coordinates : []
  const rings: (readonly [number, number])[][] = []
  for (const polygon of polygons) {
    if (!Array.isArray(polygon)) continue
    const outer: unknown = polygon[0]
    if (!Array.isArray(outer)) continue
    const ring = outer.flatMap((point: unknown): (readonly [number, number])[] => {
      if (!Array.isArray(point)) return []
      const [lon, lat] = point
      return typeof lon === "number" && typeof lat === "number" && Number.isFinite(lon) && Number.isFinite(lat) ? [[lon, lat]] : []
    })
    if (ring.length >= 3) rings.push(ring)
  }
  return rings
}

export function ringBounds(ring: FlatRing): { readonly west: number; readonly east: number; readonly south: number; readonly north: number } {
  let west = Infinity
  let east = -Infinity
  let south = Infinity
  let north = -Infinity
  for (let i = 0; i + 1 < ring.length; i += 2) {
    const lon = ring[i] ?? 0
    const lat = ring[i + 1] ?? 0
    west = Math.min(west, lon)
    east = Math.max(east, lon)
    south = Math.min(south, lat)
    north = Math.max(north, lat)
  }
  return { west, east, south, north }
}

export function pointInRing(lon: number, lat: number, ring: FlatRing): boolean {
  let inside = false
  const n = Math.floor(ring.length / 2)
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const xi = ring[i * 2] ?? 0
    const yi = ring[i * 2 + 1] ?? 0
    const xj = ring[j * 2] ?? 0
    const yj = ring[j * 2 + 1] ?? 0
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Great-circle-free distance in miles; accurate enough within a state. */
export function milesBetween(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const kmPerLon = 111.32 * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180)
  return Math.hypot((lat2 - lat1) * KM_PER_DEG_LAT, (lon2 - lon1) * kmPerLon) / 1.609344
}

/** Miles from a point to the nearest edge of a ring (0 when inside it). */
export function milesToRing(lon: number, lat: number, ring: FlatRing): number {
  if (pointInRing(lon, lat, ring)) return 0
  const kmPerLon = 111.32 * Math.cos((lat * Math.PI) / 180)
  let best = Infinity
  const n = Math.floor(ring.length / 2)
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n
    const ax = ((ring[i * 2] ?? 0) - lon) * kmPerLon
    const ay = ((ring[i * 2 + 1] ?? 0) - lat) * KM_PER_DEG_LAT
    const bx = ((ring[j * 2] ?? 0) - lon) * kmPerLon
    const by = ((ring[j * 2 + 1] ?? 0) - lat) * KM_PER_DEG_LAT
    best = Math.min(best, perpendicularDistance(0, 0, ax, ay, bx, by))
  }
  return best / 1.609344
}
