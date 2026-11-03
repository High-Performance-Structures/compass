"use server"

import { and, eq, inArray, isNotNull } from "drizzle-orm"
import { getDb } from "@/db"
import { projects } from "@/db/schema"
import { listProjectsForCurrentUser } from "@/lib/projects/project-list"
import { getCurrentUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { isInternalStaffRole } from "@/lib/user-roles"
import { DEFAULT_WEATHER_AREA } from "@/lib/weather/areas"
import { organizationWeatherArea } from "@/lib/weather/areas-server"
import { DEFAULT_WEATHER_LIMITS, type FireLayerData, type WeatherLayerData, type WeatherLimits } from "@/lib/weather/layer"
import { readFireLayer, readWeatherLayer, type WeatherJobSite } from "@/lib/weather/read-server"
import { refreshWeatherCache } from "@/lib/weather/refresh-server"

type LayerResult<T> =
  | { readonly success: true; readonly data: T; readonly limits: WeatherLimits }
  | { readonly success: false; readonly error: string }

const MAX_JOBS = 400
// D1 allows 100 bound parameters per statement.
const CHUNK = 90

/**
 * Who is looking: staff see their company's jobs; clients and trade partners
 * see only projects they can already open, with the contractor's limits.
 */
async function viewerContext(projectIds: readonly string[]) {
  const user = await getCurrentUser()
  if (!user) return null
  const { env, ctx } = await getCloudflareContext()
  if (!env?.DB) return null
  const db = getDb(env.DB)
  const requested = [...new Set(projectIds.filter((id) => typeof id === "string" && id.length > 0))].slice(0, MAX_JOBS)
  if (user.organizationId && isInternalStaffRole(user.role)) {
    return { db, ctx, organizationId: user.organizationId, projectIds: requested, staff: true }
  }
  const accessible = new Set((await listProjectsForCurrentUser()).map((project) => project.id))
  const allowed = requested.filter((id) => accessible.has(id))
  const first = allowed[0]
  if (!first) return { db, ctx, organizationId: null, projectIds: [], staff: false }
  const owner = await db
    .select({ organizationId: projects.organizationId })
    .from(projects)
    .where(eq(projects.id, first))
    .limit(1)
    .then((rows) => rows[0] ?? null)
  return { db, ctx, organizationId: owner?.organizationId ?? null, projectIds: allowed, staff: false }
}

/**
 * Weather layer: forecasts across the map area plus each listed job's own
 * site forecast. Loaded only when someone turns the layer on.
 */
export async function getPortfolioWeather(projectIds: readonly string[]): Promise<LayerResult<WeatherLayerData>> {
  try {
    const context = await viewerContext(projectIds)
    if (!context) return { success: false, error: "Sign in to see weather." }
    const { db, ctx, organizationId } = context
    const ids = context.projectIds
    const siteRows = await Promise.all(
      Array.from({ length: Math.ceil(ids.length / CHUNK) }, (_, i) => ids.slice(i * CHUNK, (i + 1) * CHUNK)).map((part) =>
        db
          .select({ id: projects.id, lat: projects.siteLatitude, lon: projects.siteLongitude })
          .from(projects)
          .where(
            and(
              context.staff && organizationId ? eq(projects.organizationId, organizationId) : undefined,
              inArray(projects.id, part),
              isNotNull(projects.siteLatitude),
              isNotNull(projects.siteLongitude),
            ),
          ),
      ),
    )
    const sites = siteRows.flat().flatMap((row): WeatherJobSite[] => (row.lat === null || row.lon === null ? [] : [{ projectId: row.id, lat: row.lat, lon: row.lon }]))
    const area = organizationId ? await organizationWeatherArea(db, organizationId) : DEFAULT_WEATHER_AREA
    const [layer, limits] = await Promise.all([
      readWeatherLayer(db, area, sites, Date.now()),
      organizationId ? readFeatureSettings(db, organizationId, "weather-alerts") : Promise.resolve(DEFAULT_WEATHER_LIMITS),
    ])
    ctx.waitUntil(
      layer
        .markInUse()
        // The very first time, start gathering forecasts now instead of waiting for the schedule.
        .then(() => (layer.data.warming ? refreshWeatherCache(db, { budgetMs: 20_000 }) : null))
        .catch(() => undefined),
    )
    return { success: true, data: layer.data, limits }
  } catch (error) {
    console.error("Portfolio weather failed", error)
    return { success: false, error: "Weather could not be loaded." }
  }
}

/** Fire & smoke layer: active wildfires and fire weather warnings for the company's map state. */
export async function getPortfolioFires(projectIds: readonly string[] = []): Promise<LayerResult<FireLayerData>> {
  try {
    const context = await viewerContext(projectIds)
    if (!context) return { success: false, error: "Sign in to see fire information." }
    const { db, ctx, organizationId } = context
    const area = organizationId ? await organizationWeatherArea(db, organizationId) : DEFAULT_WEATHER_AREA
    const [data, limits] = await Promise.all([
      readFireLayer(db, area),
      organizationId ? readFeatureSettings(db, organizationId, "weather-alerts") : Promise.resolve(DEFAULT_WEATHER_LIMITS),
    ])
    if (data.updatedAt === null) ctx.waitUntil(refreshWeatherCache(db, { budgetMs: 20_000 }).catch(() => undefined))
    return { success: true, data, limits }
  } catch (error) {
    console.error("Portfolio fires failed", error)
    return { success: false, error: "Fire information could not be loaded." }
  }
}
