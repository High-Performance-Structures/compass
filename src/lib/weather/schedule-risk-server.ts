import { and, eq, gte, inArray, isNotNull, lte, ne } from "drizzle-orm"
import type { getDb } from "@/db"
import { organizationCalendarSettings, projects, scheduleTasks, weatherScheduleRisks } from "@/db/schema"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import type { WeatherAlertSettings } from "@/lib/weather/settings"
import { notifyProjectStaffOfOutsideEvent } from "@/lib/notifications/events"
import { dateKeyInTimeZone } from "@/lib/work-calendar"
import { organizationWeatherArea } from "@/lib/weather/areas-server"
import { alertActiveBetween, alertCovers, fireFlags, type WeatherFlag } from "@/lib/weather/layer"
import { readAreaHazards, readSiteForecasts, type WeatherJobSite } from "@/lib/weather/read-server"
import { nearestAirReading } from "@/lib/weather/air"
import { addDays, scheduleAirRisks, scheduleWeatherRisks, type ScheduleRisk } from "@/lib/weather/schedule-risk"
import { SERIES_STEPS, STEP_MS, type CellSeries } from "@/lib/weather/series"

type Db = ReturnType<typeof getDb>

const DEFAULT_TIME_ZONE = "America/Denver"
/** Items starting within this many days are checked (the forecast is good for about a week). */
const RISK_HORIZON_DAYS = 5
const SWEEP_PROJECTS_PER_RUN = 60

async function organizationTimeZone(db: Db, organizationId: string): Promise<string> {
  const row = await db
    .select({ timeZone: organizationCalendarSettings.timeZone })
    .from(organizationCalendarSettings)
    .where(eq(organizationCalendarSettings.organizationId, organizationId))
    .limit(1)
    .then((rows) => rows[0] ?? null)
  return row?.timeZone || DEFAULT_TIME_ZONE
}

type ItemRow = { readonly id: string; readonly projectId: string; readonly title: string; readonly startDate: string; readonly endDate: string; readonly assignedUserId: string | null }

async function upcomingItems(db: Db, projectIds: readonly string[], today: string): Promise<ItemRow[]> {
  if (projectIds.length === 0) return []
  const horizon = addDays(today, RISK_HORIZON_DAYS)
  const rows: ItemRow[] = []
  for (let i = 0; i < projectIds.length; i += 90) {
    const part = await db
      .select({
        id: scheduleTasks.id,
        projectId: scheduleTasks.projectId,
        title: scheduleTasks.title,
        startDate: scheduleTasks.startDate,
        endDate: scheduleTasks.endDateCalculated,
        assignedUserId: scheduleTasks.assignedUserId,
      })
      .from(scheduleTasks)
      .where(
        and(
          inArray(scheduleTasks.projectId, projectIds.slice(i, i + 90)),
          ne(scheduleTasks.status, "COMPLETE"),
          lte(scheduleTasks.startDate, horizon),
          gte(scheduleTasks.endDateCalculated, today),
        ),
      )
    rows.push(...part)
  }
  return rows
}

export type SiteWeatherDay = {
  readonly date: string
  readonly highF: number | null
  readonly lowF: number | null
  readonly snowIn: number
  readonly rainIn: number
  readonly gustMph: number | null
}

export type ProjectSiteWeather =
  | { readonly status: "no_site" }
  | { readonly status: "gathering" }
  | {
      readonly status: "ready"
      readonly siteElevationFt: number | null
      readonly forecastElevationFt: number | null
      readonly days: readonly SiteWeatherDay[]
      readonly risks: readonly (ScheduleRisk & { readonly startDate: string })[]
      /** Warnings in effect at the site and fires nearby, right now. */
      readonly hazards: readonly WeatherFlag[]
      readonly updatedAt: string
    }

/** Local-day summaries for the next `count` days. */
export function dailySummary(series: CellSeries, localDate: (ms: number) => string, today: string, count: number): SiteWeatherDay[] {
  const start = Date.parse(series.start)
  const days = new Map<string, { high: number | null; low: number | null; snow: number; rain: number; gust: number | null }>()
  for (let i = 0; i < series.tempMaxF.length; i += 1) {
    const date = localDate(start + i * STEP_MS + STEP_MS / 2)
    if (date < today) continue
    const day = days.get(date) ?? { high: null, low: null, snow: 0, rain: 0, gust: null }
    const high = series.tempMaxF[i] ?? null
    const low = series.tempMinF[i] ?? null
    const gust = series.gustMph[i] ?? null
    if (high !== null) day.high = day.high === null ? high : Math.max(day.high, high)
    if (low !== null) day.low = day.low === null ? low : Math.min(day.low, low)
    if (gust !== null) day.gust = day.gust === null ? gust : Math.max(day.gust, gust)
    day.snow += series.snowIn[i] ?? 0
    day.rain += series.precipIn[i] ?? 0
    days.set(date, day)
  }
  return [...days.entries()].slice(0, count).map(([date, day]) => ({
    date,
    highF: day.high,
    lowF: day.low,
    snowIn: Math.round(day.snow * 10) / 10,
    rainIn: Math.round(Math.max(0, day.rain - day.snow / 10) * 100) / 100,
    gustMph: day.gust,
  }))
}

/** A job's site forecast, the scheduled work it puts at risk, and hazards nearby. */
export async function projectSiteWeather(db: Db, organizationId: string, projectId: string, nowMs: number): Promise<{ readonly data: ProjectSiteWeather; readonly markInUse: () => Promise<void> }> {
  const project = await db
    .select({ lat: projects.siteLatitude, lon: projects.siteLongitude, elevationFt: projects.siteElevationFt })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
    .limit(1)
    .then((rows) => rows[0] ?? null)
  const noop = async (): Promise<void> => undefined
  if (!project || project.lat === null || project.lon === null) return { data: { status: "no_site" }, markInUse: noop }
  const site: WeatherJobSite = { projectId, lat: project.lat, lon: project.lon }
  const [forecasts, hazards, limits, timeZone] = await Promise.all([
    readSiteForecasts(db, [site], nowMs, SERIES_STEPS),
    organizationWeatherArea(db, organizationId).then((area) => readAreaHazards(db, area)),
    readFeatureSettings(db, organizationId, "weather-alerts"),
    organizationTimeZone(db, organizationId),
  ])
  const forecast = forecasts.byProject.get(projectId)
  if (!forecast) return { data: { status: "gathering" }, markInUse: forecasts.markInUse }
  const localDate = (ms: number): string => dateKeyInTimeZone(new Date(ms), timeZone)
  const today = localDate(nowMs)
  const items = await upcomingItems(db, [projectId], today)
  const siteAlerts = hazards.weatherAlerts.filter((alert) => alertCovers(alert, site.lon, site.lat))
  const risks = [
    ...scheduleWeatherRisks({ items, series: forecast.series, alerts: siteAlerts, limits, rules: limits.workRules, localDate, nowMs }),
    ...scheduleAirRisks({ items, reading: nearestAirReading(hazards.air, site.lon, site.lat)?.reading ?? null, aqiLimit: limits.aqi, today }),
  ]
  const startById = new Map(items.map((item) => [item.id, item.startDate]))
  const dayMs = 24 * 60 * 60 * 1000
  const nowWarnings: WeatherFlag[] = siteAlerts
    .filter((alert) => alertActiveBetween(alert, nowMs, nowMs + dayMs))
    .map((alert) => ({ kind: "warning", label: alert.event.toUpperCase(), detail: alert.headline }))
  return {
    data: {
      status: "ready",
      siteElevationFt: project.elevationFt,
      forecastElevationFt: forecast.forecastElevationFt,
      days: dailySummary(forecast.series, localDate, today, 3),
      risks: risks.map((risk) => ({ ...risk, startDate: startById.get(risk.taskId) ?? risk.date })),
      hazards: [...nowWarnings, ...fireFlags({ fires: hazards.fires, alerts: hazards.fireAlerts, smoke: hazards.smoke, air: hazards.air }, site.lon, site.lat, limits, nowMs)],
      updatedAt: forecast.fetchedAt,
    },
    markInUse: forecasts.markInUse,
  }
}

export type ScheduleRiskSweepSummary = { readonly projects: number; readonly newRisks: number; readonly notified: number }

/**
 * Scheduled (every 10 minutes, after the weather refresh): checks upcoming
 * scheduled work on every located job against its site forecast. Each new
 * risk (item + rule + day) is recorded once and, when the company allows,
 * notifies the item's assignee and the job's staff.
 */
export async function sweepScheduleWeatherRisks(db: Db, options: { readonly budgetMs: number; readonly nowMs?: number }): Promise<ScheduleRiskSweepSummary> {
  const nowMs = options.nowMs ?? Date.now()
  const deadline = Date.now() + options.budgetMs
  // A day of margin either side; each company's own date is applied below.
  const roughToday = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  // One query: open items in the window on jobs with a located site.
  const rows = await db
    .select({
      id: scheduleTasks.id,
      projectId: scheduleTasks.projectId,
      title: scheduleTasks.title,
      startDate: scheduleTasks.startDate,
      endDate: scheduleTasks.endDateCalculated,
      assignedUserId: scheduleTasks.assignedUserId,
      organizationId: projects.organizationId,
      lat: projects.siteLatitude,
      lon: projects.siteLongitude,
      name: projects.name,
      projectNumber: projects.projectNumber,
    })
    .from(scheduleTasks)
    .innerJoin(projects, eq(projects.id, scheduleTasks.projectId))
    .where(
      and(
        isNotNull(projects.siteLatitude),
        isNotNull(projects.siteLongitude),
        isNotNull(projects.organizationId),
        ne(scheduleTasks.status, "COMPLETE"),
        lte(scheduleTasks.startDate, addDays(roughToday, RISK_HORIZON_DAYS + 2)),
        gte(scheduleTasks.endDateCalculated, roughToday),
      ),
    )
  const itemsByProject = new Map<string, ItemRow[]>()
  const projectById = new Map<string, { id: string; organizationId: string | null; lat: number | null; lon: number | null; name: string; projectNumber: string | null }>()
  for (const row of rows) {
    itemsByProject.set(row.projectId, [...(itemsByProject.get(row.projectId) ?? []), row])
    projectById.set(row.projectId, { id: row.projectId, organizationId: row.organizationId, lat: row.lat, lon: row.lon, name: row.name, projectNumber: row.projectNumber })
  }
  const active = [...projectById.values()].slice(0, SWEEP_PROJECTS_PER_RUN)
  if (active.length === 0) return { projects: 0, newRisks: 0, notified: 0 }

  const sites = active.flatMap((project): WeatherJobSite[] => (project.lat === null || project.lon === null ? [] : [{ projectId: project.id, lat: project.lat, lon: project.lon }]))
  const forecasts = await readSiteForecasts(db, sites, nowMs, SERIES_STEPS)
  await forecasts.markInUse()

  // Warnings come from each company's map state.
  const orgCache = new Map<string, { limits: WeatherAlertSettings; timeZone: string; hazards: Awaited<ReturnType<typeof readAreaHazards>> }>()
  const hazardsByArea = new Map<string, Awaited<ReturnType<typeof readAreaHazards>>>()
  let newRisks = 0
  let notified = 0
  for (const project of active) {
    if (Date.now() > deadline) break
    const organizationId = project.organizationId
    const forecast = forecasts.byProject.get(project.id)
    if (!organizationId || !forecast || project.lat === null || project.lon === null) continue
    let org = orgCache.get(organizationId)
    if (!org) {
      const area = await organizationWeatherArea(db, organizationId)
      const hazards = hazardsByArea.get(area.key) ?? (await readAreaHazards(db, area))
      hazardsByArea.set(area.key, hazards)
      org = {
        limits: await readFeatureSettings(db, organizationId, "weather-alerts"),
        timeZone: await organizationTimeZone(db, organizationId),
        hazards,
      }
      orgCache.set(organizationId, org)
    }
    const timeZone = org.timeZone
    const localDate = (ms: number): string => dateKeyInTimeZone(new Date(ms), timeZone)
    const today = localDate(nowMs)
    const projectItems = (itemsByProject.get(project.id) ?? []).filter((item) => item.endDate >= today && item.startDate <= addDays(today, RISK_HORIZON_DAYS))
    const lon = project.lon
    const lat = project.lat
    const siteAlerts = org.hazards.weatherAlerts.filter((alert) => alertCovers(alert, lon, lat))
    const risks = [
      ...scheduleWeatherRisks({ items: projectItems, series: forecast.series, alerts: siteAlerts, limits: org.limits, rules: org.limits.workRules, localDate, nowMs }),
      ...scheduleAirRisks({ items: projectItems, reading: nearestAirReading(org.hazards.air, lon, lat)?.reading ?? null, aqiLimit: org.limits.aqi, today }),
    ]
    const label = project.projectNumber ? `${project.projectNumber} - ${project.name}` : project.name
    for (const risk of risks) {
      const firstSeenAt = new Date(nowMs).toISOString()
      const inserted = await db
        .insert(weatherScheduleRisks)
        .values({ scheduleTaskId: risk.taskId, ruleId: risk.ruleId, riskDate: risk.date, organizationId, projectId: project.id, detail: risk.detail, firstSeenAt })
        .onConflictDoNothing()
        .returning({ taskId: weatherScheduleRisks.scheduleTaskId })
      if (inserted.length === 0) continue
      newRisks += 1
      if (!org.limits.notifyScheduleRisks) continue
      const item = projectItems.find((entry) => entry.id === risk.taskId)
      await notifyProjectStaffOfOutsideEvent({
        organizationId,
        projectId: project.id,
        ownerUserId: item?.assignedUserId ?? null,
        eventType: "schedule.weather_risk",
        sourceType: "schedule_task",
        sourceId: risk.taskId,
        title: `Weather risk: ${risk.taskTitle} (${label})`,
        body: risk.detail,
        href: `/dashboard/projects/${project.id}/schedule?item=${encodeURIComponent(risk.taskId)}`,
        priority: risk.kind === "warning" ? "high" : "normal",
      })
      await db
        .update(weatherScheduleRisks)
        .set({ notifiedAt: new Date().toISOString() })
        .where(and(eq(weatherScheduleRisks.scheduleTaskId, risk.taskId), eq(weatherScheduleRisks.ruleId, risk.ruleId), eq(weatherScheduleRisks.riskDate, risk.date)))
      notified += 1
    }
  }
  return { projects: active.length, newRisks, notified }
}
