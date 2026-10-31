import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm"
import type { getDb } from "@/db"
import { weatherAreaSnapshots, weatherCells, weatherPoints, weatherZoneShapes } from "@/db/schema"
import {
  insertWeatherPointsIfAbsent,
  markWeatherPointFound,
  markWeatherPointOutside,
  recordWeatherCellFailure,
  saveWeatherCellForecast,
} from "@/lib/domain/weather/store"
import { parseAlerts, withZoneShapes, zonesNeedingShapes, ALERT_TOLERANCE_DEG, type WeatherAlert } from "@/lib/weather/alerts"
import { areaSamplePoints, weatherPointKey, type WeatherArea } from "@/lib/weather/areas"
import { weatherAreasInUse } from "@/lib/weather/areas-server"
import { parseFires } from "@/lib/weather/fires"
import { outerRings, simplifyRing, type FlatRing } from "@/lib/weather/geometry"
import { parseGridSeries } from "@/lib/weather/series"

type Db = ReturnType<typeof getDb>

// NWS asks every caller to identify itself.
const NWS_HEADERS = {
  Accept: "application/geo+json",
  "User-Agent": "Compass construction management (compass.openrangeconstruction.ltd)",
}
const WFIGS = "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services"
const FETCH_TIMEOUT_MS = 8_000

const MINUTE = 60 * 1000
const ALERTS_EVERY_MS = 10 * MINUTE
const FIRES_EVERY_MS = 15 * MINUTE
const CELL_EVERY_MS = 60 * MINUTE
/** Cells and points nobody has read for this long stop refreshing. */
const IDLE_AFTER_MS = 2 * 24 * 60 * MINUTE
const ZONE_SHAPE_MAX_AGE_MS = 30 * 24 * 60 * MINUTE
const POINTS_PER_RUN = 10
// Per area shown on some company's map, up to the cap; the time budget still applies.
const CELLS_PER_RUN = 12
const MAX_CELLS_PER_RUN = 36
const ZONES_PER_RUN = 8

export type WeatherRefreshSummary = {
  readonly alerts: number
  readonly fires: number
  readonly points: number
  readonly cells: number
  readonly failures: number
}

async function getJson(url: string, headers: Record<string, string> = NWS_HEADERS): Promise<unknown> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`weather source ${response.status}`)
  return response.json()
}

function nested(value: unknown, ...keys: string[]): unknown {
  let current: unknown = value
  for (const key of keys) {
    if (typeof current !== "object" || current === null || !(key in current)) return null
    current = Reflect.get(current, key)
  }
  return current
}

/** Makes sure an area's sample points exist, so they get resolved to grid cells. */
async function seedAreaPoints(db: Db, area: WeatherArea, now: string): Promise<void> {
  const rows = areaSamplePoints(area).map((point) => ({
    pointKey: weatherPointKey(point.lat, point.lon),
    latitude: Number(point.lat.toFixed(2)),
    longitude: Number(point.lon.toFixed(2)),
    requestedAt: now,
  }))
  await insertWeatherPointsIfAbsent(db, rows)
}

async function snapshotAge(db: Db, areaKey: string, kind: string, nowMs: number): Promise<number> {
  const row = await db
    .select({ fetchedAt: weatherAreaSnapshots.fetchedAt })
    .from(weatherAreaSnapshots)
    .where(and(eq(weatherAreaSnapshots.areaKey, areaKey), eq(weatherAreaSnapshots.kind, kind)))
    .limit(1)
    .then((rows) => rows[0] ?? null)
  return row ? nowMs - Date.parse(row.fetchedAt) : Number.POSITIVE_INFINITY
}

async function storeSnapshot(db: Db, areaKey: string, kind: string, payload: string, now: string): Promise<void> {
  await db
    .insert(weatherAreaSnapshots)
    .values({ areaKey, kind, payload, fetchedAt: now, failureCount: 0 })
    .onConflictDoUpdate({
      target: [weatherAreaSnapshots.areaKey, weatherAreaSnapshots.kind],
      set: { payload, fetchedAt: now, failureCount: 0 },
    })
}

async function zoneShapes(db: Db, zoneIds: readonly string[], deadline: number, nowMs: number): Promise<Map<string, FlatRing[]>> {
  const shapes = new Map<string, FlatRing[]>()
  if (zoneIds.length === 0) return shapes
  const cached = await db.select().from(weatherZoneShapes).where(inArray(weatherZoneShapes.zoneId, [...zoneIds]))
  for (const row of cached) {
    try {
      const rings: unknown = JSON.parse(row.rings)
      if (Array.isArray(rings)) shapes.set(row.zoneId, rings.filter((ring: unknown): ring is number[] => Array.isArray(ring)))
    } catch {
      // Refetched below.
    }
  }
  const fresh = new Set(cached.filter((row) => nowMs - Date.parse(row.fetchedAt) < ZONE_SHAPE_MAX_AGE_MS).map((row) => row.zoneId))
  const missing = zoneIds.filter((zone) => !fresh.has(zone)).slice(0, ZONES_PER_RUN)
  for (const zoneId of missing) {
    if (Date.now() > deadline) break
    if (!/^[a-z]+\/[A-Z0-9]+$/.test(zoneId)) continue
    try {
      const zone = await getJson(`https://api.weather.gov/zones/${zoneId}`)
      const rings = outerRings(nested(zone, "geometry")).map((ring) => simplifyRing(ring, ALERT_TOLERANCE_DEG))
      if (rings.length === 0) continue
      shapes.set(zoneId, rings)
      const now = new Date().toISOString()
      await db
        .insert(weatherZoneShapes)
        .values({ zoneId, rings: JSON.stringify(rings), fetchedAt: now })
        .onConflictDoUpdate({ target: weatherZoneShapes.zoneId, set: { rings: JSON.stringify(rings), fetchedAt: now } })
    } catch {
      // A zone without an outline is skipped this run.
    }
  }
  return shapes
}

async function refreshAlerts(db: Db, area: WeatherArea, deadline: number, nowMs: number): Promise<number> {
  const value = await getJson(`https://api.weather.gov/alerts/active?area=${area.states.join(",")}`)
  const parsed: WeatherAlert[] = parseAlerts(value)
  const shapes = await zoneShapes(db, zonesNeedingShapes(parsed), deadline, nowMs)
  const alerts = withZoneShapes(parsed, shapes)
    .filter((alert) => alert.rings.length > 0)
    .map((alert) => ({ ...alert, zoneIds: [] }))
  await storeSnapshot(db, area.key, "alerts", JSON.stringify(alerts), new Date().toISOString())
  return alerts.length
}

function arcgisQuery(layer: string, where: string, outFields: string, area: WeatherArea, extra: Record<string, string>): string {
  const pad = 0.5
  const params = new URLSearchParams({
    where,
    geometry: `${area.west - pad},${area.south - pad},${area.east + pad},${area.north + pad}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields,
    outSR: "4326",
    f: "geojson",
    ...extra,
  })
  return `${WFIGS}/${layer}/FeatureServer/0/query?${params.toString()}`
}

async function refreshFires(db: Db, area: WeatherArea, nowMs: number): Promise<number> {
  // Fires updated in the last two weeks that are not out or fully contained.
  const since = new Date(nowMs - 14 * 24 * 60 * MINUTE).toISOString().slice(0, 19).replace("T", " ")
  const [incidents, perimeters] = await Promise.all([
    getJson(
      arcgisQuery(
        "WFIGS_Incident_Locations_Current",
        `IncidentTypeCategory='WF' AND FireOutDateTime IS NULL AND (PercentContained IS NULL OR PercentContained < 100) AND ModifiedOnDateTime_dt > TIMESTAMP '${since}'`,
        "IncidentName,IncidentSize,PercentContained,FireDiscoveryDateTime,ModifiedOnDateTime_dt,IrwinID",
        area,
        {},
      ),
      { Accept: "application/json" },
    ),
    getJson(
      arcgisQuery(
        "WFIGS_Interagency_Perimeters_Current",
        "attr_FireOutDateTime IS NULL AND (attr_PercentContained IS NULL OR attr_PercentContained < 100)",
        "poly_IncidentName,poly_IRWINID,attr_IrwinID,attr_IncidentSize,poly_GISAcres,attr_PercentContained,poly_DateCurrent",
        area,
        { maxAllowableOffset: "0.0025", geometryPrecision: "4" },
      ),
      { Accept: "application/json" },
    ),
  ])
  const fires = parseFires(incidents, perimeters)
  await storeSnapshot(db, area.key, "fires", JSON.stringify(fires), new Date().toISOString())
  return fires.length
}

async function markSnapshotFailure(db: Db, areaKey: string, kind: string): Promise<void> {
  await db
    .update(weatherAreaSnapshots)
    .set({ failureCount: sql`${weatherAreaSnapshots.failureCount} + 1` })
    .where(and(eq(weatherAreaSnapshots.areaKey, areaKey), eq(weatherAreaSnapshots.kind, kind)))
}

/** Pending points → their NWS grid cell (one /points call each, once ever). */
async function resolvePoints(db: Db, deadline: number, nowMs: number): Promise<{ resolved: number; failures: number }> {
  const idleBefore = new Date(nowMs - IDLE_AFTER_MS).toISOString()
  const pending = await db
    .select()
    .from(weatherPoints)
    .where(and(eq(weatherPoints.status, "pending"), sql`${weatherPoints.requestedAt} > ${idleBefore}`))
    .orderBy(asc(weatherPoints.requestedAt))
    .limit(POINTS_PER_RUN)
  let resolved = 0
  let failures = 0
  // One NWS /points call per point, in sequence: the NWS API is rate limited
  // and the run stops at its time budget.
  for (const point of pending) {
    if (Date.now() > deadline) break
    const now = new Date().toISOString()
    try {
      const response = await fetch(`https://api.weather.gov/points/${point.latitude.toFixed(4)},${point.longitude.toFixed(4)}`, {
        headers: NWS_HEADERS,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (response.status === 404) {
        // Outside NWS coverage (offshore, outside the US).
        await markWeatherPointOutside(db, point.pointKey, now)
        continue
      }
      if (!response.ok) throw new Error(`points ${response.status}`)
      const body: unknown = await response.json()
      const office = nested(body, "properties", "gridId")
      const x = nested(body, "properties", "gridX")
      const y = nested(body, "properties", "gridY")
      if (typeof office !== "string" || typeof x !== "number" || typeof y !== "number") throw new Error("points shape")
      const cellKey = `${office}/${x},${y}`
      await markWeatherPointFound(db, {
        pointKey: point.pointKey,
        cell: { cellKey, latitude: point.latitude, longitude: point.longitude, requestedAt: point.requestedAt },
        now,
      })
      resolved += 1
    } catch {
      failures += 1
    }
  }
  return { resolved, failures }
}

/** Refreshes the stalest cells someone has read recently. */
async function refreshCells(db: Db, deadline: number, nowMs: number, limit: number): Promise<{ refreshed: number; failures: number }> {
  const now = new Date(nowMs).toISOString()
  const idleBefore = new Date(nowMs - IDLE_AFTER_MS).toISOString()
  const staleBefore = new Date(nowMs - CELL_EVERY_MS).toISOString()
  const due = await db
    .select({ cellKey: weatherCells.cellKey, failureCount: weatherCells.failureCount })
    .from(weatherCells)
    .where(
      and(
        sql`${weatherCells.requestedAt} > ${idleBefore}`,
        or(isNull(weatherCells.fetchedAt), lt(weatherCells.fetchedAt, staleBefore)),
        or(isNull(weatherCells.nextAttemptAt), lte(weatherCells.nextAttemptAt, now)),
      ),
    )
    .orderBy(sql`${weatherCells.fetchedAt} IS NOT NULL`, asc(weatherCells.fetchedAt))
    .limit(limit)
  let refreshed = 0
  let failures = 0
  // One NWS gridpoints call per cell, in sequence: the NWS API is rate
  // limited and the run stops at its time budget.
  for (const cell of due) {
    if (Date.now() > deadline) break
    const [office, xy] = cell.cellKey.split("/")
    try {
      const grid = await getJson(`https://api.weather.gov/gridpoints/${office}/${xy}`)
      const properties = nested(grid, "properties")
      const series = parseGridSeries(properties, Date.now())
      if (!series) throw new Error("grid shape")
      const elevation = nested(properties, "elevation", "value")
      await saveWeatherCellForecast(db, {
        cellKey: cell.cellKey,
        series: JSON.stringify(series),
        elevationM: typeof elevation === "number" ? Math.round(elevation) : null,
        fetchedAt: new Date().toISOString(),
      })
      refreshed += 1
    } catch {
      failures += 1
      // Back off: 10 minutes, doubling, at most 6 hours.
      const delay = Math.min(6 * 60, 10 * 2 ** cell.failureCount) * MINUTE
      await recordWeatherCellFailure(db, {
        cellKey: cell.cellKey,
        failureCount: cell.failureCount + 1,
        nextAttemptAt: new Date(Date.now() + delay).toISOString(),
      })
    }
  }
  return { refreshed, failures }
}

/**
 * Scheduled (every 10 minutes): warnings, fires, new grid points and stale
 * forecasts, each capped per run and stopped at the time budget.
 */
export async function refreshWeatherCache(db: Db, options: { readonly budgetMs: number }): Promise<WeatherRefreshSummary> {
  const nowMs = Date.now()
  const deadline = nowMs + options.budgetMs
  const now = new Date(nowMs).toISOString()
  let alerts = 0
  let fires = 0
  let failures = 0
  const areas = await weatherAreasInUse(db)
  for (const area of areas) {
    await seedAreaPoints(db, area, now)
    if ((await snapshotAge(db, area.key, "alerts", nowMs)) >= ALERTS_EVERY_MS) {
      try {
        alerts += await refreshAlerts(db, area, deadline, nowMs)
      } catch {
        failures += 1
        await markSnapshotFailure(db, area.key, "alerts")
      }
    }
    if (Date.now() < deadline && (await snapshotAge(db, area.key, "fires", nowMs)) >= FIRES_EVERY_MS) {
      try {
        fires += await refreshFires(db, area, nowMs)
      } catch {
        failures += 1
        await markSnapshotFailure(db, area.key, "fires")
      }
    }
  }
  const points = Date.now() < deadline ? await resolvePoints(db, deadline, nowMs) : { resolved: 0, failures: 0 }
  const cells = Date.now() < deadline ? await refreshCells(db, deadline, nowMs, Math.min(MAX_CELLS_PER_RUN, CELLS_PER_RUN * Math.max(1, areas.length))) : { refreshed: 0, failures: 0 }
  return {
    alerts,
    fires,
    points: points.resolved,
    cells: cells.refreshed,
    failures: failures + points.failures + cells.failures,
  }
}
