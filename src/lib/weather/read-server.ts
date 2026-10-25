import { and, eq, inArray, lt } from "drizzle-orm"
import type { getDb } from "@/db"
import { weatherAreaSnapshots, weatherCells, weatherPoints } from "@/db/schema"
import { readAlerts } from "@/lib/weather/alerts"
import { areaSamplePoints, weatherPointKey, type WeatherArea } from "@/lib/weather/areas"
import { readFires } from "@/lib/weather/fires"
import { FLAG_WINDOW_STEPS, LAYER_STEPS, type FireLayerData, type JobWeather, type WeatherLayerCell, type WeatherLayerData } from "@/lib/weather/layer"
import { alignSeries, readCellSeries, stepStart } from "@/lib/weather/series"

type Db = ReturnType<typeof getDb>

/** Steps sent per forecast: the time bar plus a day of look-ahead for job flags. */
export const SENT_STEPS = LAYER_STEPS + FLAG_WINDOW_STEPS - 1
// Re-stamp a cell or point as in use at most this often.
const TOUCH_EVERY_MS = 60 * 60 * 1000
// D1 allows 100 bound parameters per statement.
const CHUNK = 90

export type WeatherJobSite = { readonly projectId: string; readonly lat: number; readonly lon: number }

function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK))
  return out
}

async function selectPoints(db: Db, keys: readonly string[]) {
  const rows = await Promise.all(chunks([...new Set(keys)]).map((part) => db.select().from(weatherPoints).where(inArray(weatherPoints.pointKey, part))))
  return rows.flat()
}

async function selectCells(db: Db, keys: readonly string[]) {
  const rows = await Promise.all(chunks([...new Set(keys)]).map((part) => db.select().from(weatherCells).where(inArray(weatherCells.cellKey, part))))
  return rows.flat()
}

async function snapshot(db: Db, areaKey: string, kind: string) {
  return db
    .select({ payload: weatherAreaSnapshots.payload, fetchedAt: weatherAreaSnapshots.fetchedAt })
    .from(weatherAreaSnapshots)
    .where(and(eq(weatherAreaSnapshots.areaKey, areaKey), eq(weatherAreaSnapshots.kind, kind)))
    .limit(1)
    .then((rows) => rows[0] ?? null)
}

/**
 * The Weather layer for an area and the given job sites. Returns the data and
 * a follow-up that marks what was read as in use (run after responding) so
 * the background refresh keeps it current; new job sites are queued.
 */
export async function readWeatherLayer(
  db: Db,
  area: WeatherArea,
  sites: readonly WeatherJobSite[],
  nowMs: number,
): Promise<{ readonly data: WeatherLayerData; readonly markInUse: () => Promise<void> }> {
  const sampleKeys = areaSamplePoints(area).map((point) => weatherPointKey(point.lat, point.lon))
  const siteKeys = new Map(sites.map((site) => [site.projectId, weatherPointKey(site.lat, site.lon)]))
  const [points, alertRow] = await Promise.all([selectPoints(db, [...sampleKeys, ...siteKeys.values()]), snapshot(db, area.key, "alerts")])
  const pointByKey = new Map(points.map((point) => [point.pointKey, point]))
  const cellKeys = points.flatMap((point) => (point.cellKey ? [point.cellKey] : []))
  const cells = await selectCells(db, cellKeys)
  const cellByKey = new Map(cells.map((cell) => [cell.cellKey, cell]))

  const start = stepStart(nowMs)
  const aligned = new Map<string, NonNullable<ReturnType<typeof readCellSeries>>>()
  let oldest: string | null = null
  for (const cell of cells) {
    const series = readCellSeries(cell.series)
    if (!series || !cell.fetchedAt) continue
    aligned.set(cell.cellKey, alignSeries(series, start, SENT_STEPS))
    if (oldest === null || cell.fetchedAt < oldest) oldest = cell.fetchedAt
  }

  const seenCells = new Set<string>()
  const mapCells: WeatherLayerCell[] = []
  for (const key of sampleKeys) {
    const point = pointByKey.get(key)
    const cell = point?.cellKey ? cellByKey.get(point.cellKey) : undefined
    const series = cell ? aligned.get(cell.cellKey) : undefined
    if (!point || !cell || !series || seenCells.has(cell.cellKey)) continue
    seenCells.add(cell.cellKey)
    mapCells.push({ lon: point.longitude, lat: point.latitude, series })
  }
  const jobs: JobWeather[] = []
  for (const [projectId, key] of siteKeys) {
    const point = pointByKey.get(key)
    const cell = point?.cellKey ? cellByKey.get(point.cellKey) : undefined
    const series = cell ? aligned.get(cell.cellKey) : undefined
    if (!cell || !series) continue
    jobs.push({ projectId, forecastElevationFt: cell.elevationM === null ? null : Math.round(cell.elevationM * 3.28084), series })
  }

  const alerts = readAlerts(alertRow?.payload ?? null).filter((alert) => alert.kind !== "fire")
  const markInUse = async (): Promise<void> => {
    const now = new Date(nowMs).toISOString()
    const touchBefore = new Date(nowMs - TOUCH_EVERY_MS).toISOString()
    const newSites = sites.filter((site) => !pointByKey.has(weatherPointKey(site.lat, site.lon)))
    for (const part of chunks(newSites)) {
      // Four columns each: stay under D1's parameter limit.
      for (let i = 0; i < part.length; i += 20) {
        await db
          .insert(weatherPoints)
          .values(part.slice(i, i + 20).map((site) => ({
            pointKey: weatherPointKey(site.lat, site.lon),
            latitude: Number(site.lat.toFixed(2)),
            longitude: Number(site.lon.toFixed(2)),
            requestedAt: now,
          })))
          .onConflictDoNothing()
      }
    }
    for (const part of chunks(points.filter((point) => point.requestedAt < touchBefore).map((point) => point.pointKey))) {
      await db.update(weatherPoints).set({ requestedAt: now }).where(inArray(weatherPoints.pointKey, part))
    }
    for (const part of chunks(cellKeys)) {
      await db
        .update(weatherCells)
        .set({ requestedAt: now })
        .where(and(inArray(weatherCells.cellKey, part), lt(weatherCells.requestedAt, touchBefore)))
    }
  }

  return {
    data: {
      start: new Date(start).toISOString(),
      steps: LAYER_STEPS,
      areaKey: area.key,
      cells: mapCells,
      alerts,
      jobs,
      updatedAt: oldest,
      warming: mapCells.length < Math.ceil(sampleKeys.length / 2),
    },
    markInUse,
  }
}

/** The Fire & smoke layer for an area: active fires and fire weather warnings. */
export async function readFireLayer(db: Db, area: WeatherArea): Promise<FireLayerData> {
  const [fireRow, alertRow] = await Promise.all([snapshot(db, area.key, "fires"), snapshot(db, area.key, "alerts")])
  return {
    areaKey: area.key,
    fires: readFires(fireRow?.payload ?? null),
    alerts: readAlerts(alertRow?.payload ?? null).filter((alert) => alert.kind === "fire"),
    updatedAt: fireRow?.fetchedAt ?? null,
  }
}
