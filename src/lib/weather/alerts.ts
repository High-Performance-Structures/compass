import { outerRings, simplifyRing, type FlatRing } from "@/lib/weather/geometry"

/** How a National Weather Service warning is drawn and which layer shows it. */
export type AlertKind = "winter" | "wind" | "flood" | "storm" | "heat" | "cold" | "fire"

export type WeatherAlert = {
  readonly id: string
  /** The NWS event name, e.g. "Winter Storm Warning". */
  readonly event: string
  readonly kind: AlertKind
  /** "warning", "watch" or "advisory", from the event name. */
  readonly level: "warning" | "watch" | "advisory"
  readonly headline: string
  readonly onset: string | null
  readonly ends: string | null
  readonly rings: readonly FlatRing[]
  /** Zones ("forecast/COZ034", "fire/COZ214") the warning covers, used when it has no outline of its own. */
  readonly zoneIds: readonly string[]
}

const KIND_PATTERNS: readonly (readonly [AlertKind, RegExp])[] = [
  ["fire", /red flag|fire weather|fire warning|extreme fire/i],
  ["winter", /winter|blizzard|ice storm|snow|avalanche|freezing (rain|spray)/i],
  ["cold", /wind chill|extreme cold|cold weather|hard freeze|freeze (warning|watch)|frost/i],
  ["heat", /heat/i],
  ["wind", /high wind|wind advisory|extreme wind|dust storm|blowing dust/i],
  ["storm", /thunderstorm|tornado/i],
  ["flood", /flood/i],
]

/** The kind for an NWS event name, or null for events the map doesn't draw. */
export function alertKind(event: string): AlertKind | null {
  for (const [kind, pattern] of KIND_PATTERNS) if (pattern.test(event)) return kind
  return null
}

function alertLevel(event: string): WeatherAlert["level"] {
  if (/warning/i.test(event)) return "warning"
  if (/watch/i.test(event)) return "watch"
  return "advisory"
}

const text = (record: object, key: string): string | null => {
  const value: unknown = key in record ? Reflect.get(record, key) : null
  return typeof value === "string" && value.trim() ? value.trim() : null
}

/** Outline tolerance for warnings: about 1 km, plenty at map scale. */
export const ALERT_TOLERANCE_DEG = 0.01

/** NWS /alerts/active GeoJSON → the warnings the map draws. */
export function parseAlerts(value: unknown): WeatherAlert[] {
  if (typeof value !== "object" || value === null || !("features" in value) || !Array.isArray(value.features)) return []
  const alerts: WeatherAlert[] = []
  for (const feature of value.features) {
    if (typeof feature !== "object" || feature === null || !("properties" in feature)) continue
    const properties: unknown = feature.properties
    if (typeof properties !== "object" || properties === null) continue
    const event = text(properties, "event")
    const id = text(properties, "id")
    if (!event || !id) continue
    const kind = alertKind(event)
    if (!kind) continue
    const status = text(properties, "status")
    if (status && status !== "Actual") continue
    const geometry: unknown = "geometry" in feature ? feature.geometry : null
    const zones: unknown = "affectedZones" in properties ? properties.affectedZones : null
    const zoneIds = Array.isArray(zones)
      ? zones.flatMap((zone: unknown) => {
          // ".../zones/fire/COZ214" → "fire/COZ214": fire and forecast zones share ids.
          const match = typeof zone === "string" ? /\/zones\/([a-z]+\/[A-Z0-9]+)$/.exec(zone) : null
          return match?.[1] ? [match[1]] : []
        })
      : []
    alerts.push({
      id,
      event,
      kind,
      level: alertLevel(event),
      headline: text(properties, "headline") ?? event,
      onset: text(properties, "onset") ?? text(properties, "effective"),
      ends: text(properties, "ends") ?? text(properties, "expires"),
      rings: outerRings(geometry).map((ring) => simplifyRing(ring, ALERT_TOLERANCE_DEG)),
      zoneIds,
    })
  }
  return alerts
}

/** Zone ids still needing an outline: warnings without their own shape. */
export function zonesNeedingShapes(alerts: readonly WeatherAlert[]): string[] {
  return [...new Set(alerts.filter((alert) => alert.rings.length === 0).flatMap((alert) => alert.zoneIds))]
}

/** Fills warnings issued by zone with the zones' cached outlines. */
export function withZoneShapes(alerts: readonly WeatherAlert[], shapes: ReadonlyMap<string, readonly FlatRing[]>): WeatherAlert[] {
  return alerts.map((alert) =>
    alert.rings.length > 0 ? alert : { ...alert, rings: alert.zoneIds.flatMap((zone) => shapes.get(zone) ?? []) },
  )
}

/** Stored alerts payload → alerts (malformed entries dropped). */
export function readAlerts(textValue: string | null): WeatherAlert[] {
  if (!textValue) return []
  try {
    const value: unknown = JSON.parse(textValue)
    if (!Array.isArray(value)) return []
    return value.flatMap((item: unknown): WeatherAlert[] => {
      if (typeof item !== "object" || item === null) return []
      const id = text(item, "id")
      const event = text(item, "event")
      const kind = event ? alertKind(event) : null
      if (!id || !event || !kind) return []
      const rings: unknown = "rings" in item ? item.rings : null
      return [{
        id,
        event,
        kind,
        level: alertLevel(event),
        headline: text(item, "headline") ?? event,
        onset: text(item, "onset"),
        ends: text(item, "ends"),
        rings: Array.isArray(rings) ? rings.filter((ring: unknown): ring is number[] => Array.isArray(ring) && ring.every((n: unknown) => typeof n === "number")) : [],
        zoneIds: [],
      }]
    })
  } catch {
    return []
  }
}
