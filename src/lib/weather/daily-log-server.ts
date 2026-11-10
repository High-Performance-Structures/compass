import { and, eq } from "drizzle-orm"
import type { getDb } from "@/db"
import { projects } from "@/db/schema"
import { weatherCodeLabel } from "@/lib/domain/field/rules"
import { isRecord } from "@/lib/shared/guards"
import { dateKeyInTimeZone } from "@/lib/work-calendar"
import { forecastLogWeather, recordedLogWeather, type LogWeather, type RecordedWeatherDay } from "@/lib/weather/daily-log-line"
import { organizationTimeZone, projectSiteWeather } from "@/lib/weather/schedule-risk-server"

type Db = ReturnType<typeof getDb>

const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
const FETCH_TIMEOUT_MS = 6_000

/**
 * The daily log weather for a job and date from its stored site forecast
 * (today and the next two days), or null when the job has no located site,
 * its forecast is still being gathered, or the date is outside the forecast.
 * Reads only stored data; no weather service is called.
 */
async function siteForecastLogWeather(
  db: Db,
  organizationId: string,
  projectId: string,
  logDate: string,
  nowMs: number,
): Promise<LogWeather | null> {
  const { data, markInUse } = await projectSiteWeather(db, organizationId, projectId, nowMs)
  // Keeps this job's forecast cell refreshing.
  await markInUse().catch(() => undefined)
  if (data.status !== "ready") return null
  const day = data.days.find((entry) => entry.date === logDate)
  if (!day) return null
  // Hazards are what is in effect now, so only today's log carries them.
  return forecastLogWeather(day, day === data.days[0] ? data.hazards : [])
}

function dailyNumber(daily: Readonly<Record<string, unknown>>, key: string): number | null {
  const values = daily[key]
  const first: unknown = Array.isArray(values) ? values[0] : null
  return typeof first === "number" && Number.isFinite(first) ? first : null
}

/**
 * A past local day's recorded weather at a point (Open-Meteo historical
 * archive, available through yesterday), or null when it can't be read.
 */
export async function fetchRecordedWeatherDay(
  point: { readonly lat: number; readonly lon: number },
  date: string,
  timeZone: string,
): Promise<RecordedWeatherDay | null> {
  const url = new URL(ARCHIVE_URL)
  url.searchParams.set("latitude", point.lat.toFixed(4))
  url.searchParams.set("longitude", point.lon.toFixed(4))
  url.searchParams.set("start_date", date)
  url.searchParams.set("end_date", date)
  url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,rain_sum,snowfall_sum,wind_gusts_10m_max")
  url.searchParams.set("temperature_unit", "fahrenheit")
  url.searchParams.set("precipitation_unit", "inch")
  url.searchParams.set("wind_speed_unit", "mph")
  url.searchParams.set("timezone", timeZone)
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "Compass project management weather lookup" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) return null
  const parsed: unknown = await response.json()
  const daily = isRecord(parsed) ? parsed.daily : null
  if (!isRecord(daily)) return null
  const highF = dailyNumber(daily, "temperature_2m_max")
  const lowF = dailyNumber(daily, "temperature_2m_min")
  const code = dailyNumber(daily, "weather_code")
  // A day the archive hasn't filled in yet comes back as nulls.
  if (highF === null && lowF === null && code === null) return null
  const gust = dailyNumber(daily, "wind_gusts_10m_max")
  return {
    sky: weatherCodeLabel(code),
    highF: highF === null ? null : Math.round(highF),
    lowF: lowF === null ? null : Math.round(lowF),
    rainIn: Math.round((dailyNumber(daily, "rain_sum") ?? 0) * 100) / 100,
    snowIn: Math.round((dailyNumber(daily, "snowfall_sum") ?? 0) * 10) / 10,
    gustMph: gust === null ? null : Math.round(gust),
  }
}

export type DatedLogWeather = { readonly weather: LogWeather; readonly source: "site_forecast" | "recorded" }

/**
 * A daily log's weather for its date at the job's located site: the site
 * forecast for today and the next two days, what was recorded for past days
 * (in the company's time zone), else null.
 */
export async function siteLogWeather(
  db: Db,
  organizationId: string,
  projectId: string,
  logDate: string,
  nowMs: number,
): Promise<DatedLogWeather | null> {
  const forecast = await siteForecastLogWeather(db, organizationId, projectId, logDate, nowMs)
  if (forecast) return { weather: forecast, source: "site_forecast" }
  const [project, timeZone] = await Promise.all([
    db
      .select({ lat: projects.siteLatitude, lon: projects.siteLongitude })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    organizationTimeZone(db, organizationId),
  ])
  if (!project || project.lat === null || project.lon === null) return null
  if (logDate >= dateKeyInTimeZone(new Date(nowMs), timeZone)) return null
  const day = await fetchRecordedWeatherDay({ lat: project.lat, lon: project.lon }, logDate, timeZone)
  return day ? { weather: recordedLogWeather(day), source: "recorded" } : null
}
