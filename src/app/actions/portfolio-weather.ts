"use server"

import { and, eq, inArray, isNotNull } from "drizzle-orm"
import { getDb } from "@/db"
import { projects } from "@/db/schema"
import { getCurrentUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { isInternalStaffRole } from "@/lib/user-roles"
import { DEFAULT_WEATHER_AREA } from "@/lib/weather/areas"
import type { FireLayerData, WeatherLayerData, WeatherLimits } from "@/lib/weather/layer"
import { readFireLayer, readWeatherLayer, type WeatherJobSite } from "@/lib/weather/read-server"
import { refreshWeatherCache } from "@/lib/weather/refresh-server"

type LayerResult<T> =
  | { readonly success: true; readonly data: T; readonly limits: WeatherLimits }
  | { readonly success: false; readonly error: string }

const MAX_JOBS = 400
// D1 allows 100 bound parameters per statement.
const CHUNK = 90

async function staffContext() {
  const user = await getCurrentUser()
  if (!user?.organizationId || !isInternalStaffRole(user.role)) return null
  const { env, ctx } = await getCloudflareContext()
  if (!env?.DB) return null
  return { db: getDb(env.DB), ctx, organizationId: user.organizationId }
}

/**
 * Weather layer: forecasts across the map area plus each listed job's own
 * site forecast. Loaded only when someone turns the layer on.
 */
export async function getPortfolioWeather(projectIds: readonly string[]): Promise<LayerResult<WeatherLayerData>> {
  try {
    const context = await staffContext()
    if (!context) return { success: false, error: "Weather is available to staff." }
    const { db, ctx, organizationId } = context
    const ids = [...new Set(projectIds.filter((id) => typeof id === "string" && id.length > 0))].slice(0, MAX_JOBS)
    const siteRows = await Promise.all(
      Array.from({ length: Math.ceil(ids.length / CHUNK) }, (_, i) => ids.slice(i * CHUNK, (i + 1) * CHUNK)).map((part) =>
        db
          .select({ id: projects.id, lat: projects.siteLatitude, lon: projects.siteLongitude })
          .from(projects)
          .where(and(eq(projects.organizationId, organizationId), inArray(projects.id, part), isNotNull(projects.siteLatitude), isNotNull(projects.siteLongitude))),
      ),
    )
    const sites = siteRows.flat().flatMap((row): WeatherJobSite[] => (row.lat === null || row.lon === null ? [] : [{ projectId: row.id, lat: row.lat, lon: row.lon }]))
    const [layer, limits] = await Promise.all([
      readWeatherLayer(db, DEFAULT_WEATHER_AREA, sites, Date.now()),
      readFeatureSettings(db, organizationId, "weather-alerts"),
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

/** Fire & smoke layer: active wildfires and fire weather warnings for the map area. */
export async function getPortfolioFires(): Promise<LayerResult<FireLayerData>> {
  try {
    const context = await staffContext()
    if (!context) return { success: false, error: "Fire information is available to staff." }
    const { db, ctx, organizationId } = context
    const [data, limits] = await Promise.all([
      readFireLayer(db, DEFAULT_WEATHER_AREA),
      readFeatureSettings(db, organizationId, "weather-alerts"),
    ])
    if (data.updatedAt === null) ctx.waitUntil(refreshWeatherCache(db, { budgetMs: 20_000 }).catch(() => undefined))
    return { success: true, data, limits }
  } catch (error) {
    console.error("Portfolio fires failed", error)
    return { success: false, error: "Fire information could not be loaded." }
  }
}
