import type { getDb } from "@/db"
import { forecastLogWeather, type ForecastLogWeather } from "@/lib/weather/daily-log-line"
import { projectSiteWeather } from "@/lib/weather/schedule-risk-server"

type Db = ReturnType<typeof getDb>

/**
 * The daily log weather for a job and date from its stored site forecast
 * (today and the next two days), or null when the job has no located site,
 * its forecast is still being gathered, or the date is outside the forecast.
 * Reads only stored data; no weather service is called.
 */
export async function siteForecastLogWeather(
  db: Db,
  organizationId: string,
  projectId: string,
  logDate: string,
  nowMs: number,
): Promise<ForecastLogWeather | null> {
  const { data, markInUse } = await projectSiteWeather(db, organizationId, projectId, nowMs)
  // Keeps this job's forecast cell refreshing.
  await markInUse().catch(() => undefined)
  if (data.status !== "ready") return null
  const day = data.days.find((entry) => entry.date === logDate)
  if (!day) return null
  // Hazards are what is in effect now, so only today's log carries them.
  return forecastLogWeather(day, day === data.days[0] ? data.hazards : [])
}
