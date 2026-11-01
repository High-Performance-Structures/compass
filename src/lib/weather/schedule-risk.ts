import { AIR_CATEGORY_LABEL, airTimeLabel, airValue, type AirReading } from "@/lib/weather/air"
import type { WeatherAlert } from "@/lib/weather/alerts"
import { alertActiveBetween, type WeatherLimits } from "@/lib/weather/layer"
import { STEP_MS, type CellSeries } from "@/lib/weather/series"

/** What a work rule checks over an item's days. */
export const WEATHER_RULE_CHECKS = ["low_below", "high_above", "gust_over", "rain_over", "snow_over"] as const
export type WeatherRuleCheck = (typeof WEATHER_RULE_CHECKS)[number]

export const WEATHER_RULE_CHECK_LABEL: Readonly<Record<WeatherRuleCheck, { readonly before: string; readonly unit: string }>> = {
  low_below: { before: "Low below", unit: "°F" },
  high_above: { before: "High above", unit: "°F" },
  gust_over: { before: "Gusts over", unit: "mph" },
  rain_over: { before: "Rain over", unit: "in. in 24 hours" },
  snow_over: { before: "Snow over", unit: "in. in 24 hours" },
}

export type WorkRule = {
  readonly id: string
  readonly label: string
  readonly keywords: readonly string[]
  readonly check: WeatherRuleCheck
  readonly value: number
  readonly daysAfter: number
}

/** Starting rules; each company edits them in Settings. */
export const DEFAULT_WEATHER_WORK_RULES: readonly WorkRule[] = [
  { id: "pour", label: "Concrete pours", keywords: ["pour", "concrete", "footing", "foundation", "slab", "flatwork", "stem wall"], check: "low_below", value: 40, daysAfter: 3 },
  { id: "lifts", label: "Roofing, cranes and lifts", keywords: ["roof", "crane", "lift", "sheathing", "truss", "shingle"], check: "gust_over", value: 30, daysAfter: 0 },
  { id: "exterior", label: "Exterior work in rain", keywords: ["excavat", "grading", "backfill", "paint", "siding", "stucco", "asphalt"], check: "rain_over", value: 0.5, daysAfter: 0 },
]

export type ScheduleItemForRisk = {
  readonly id: string
  readonly title: string
  /** Local dates (YYYY-MM-DD). */
  readonly startDate: string
  readonly endDate: string
}

export type ScheduleRiskKind = "cold" | "heat" | "wind" | "rain" | "snow" | "warning" | "air"

export type ScheduleRisk = {
  readonly taskId: string
  readonly taskTitle: string
  /** The rule id, or "warning", "snow", "cold", "heat", "air" for checks on every item. */
  readonly ruleId: string
  readonly kind: ScheduleRiskKind
  /** Short label, e.g. "COLD". */
  readonly label: string
  /** One sentence: what and when. */
  readonly detail: string
  /** First local date the limit is crossed. */
  readonly date: string
}

const KIND_FOR_CHECK: Readonly<Record<WeatherRuleCheck, ScheduleRiskKind>> = {
  low_below: "cold",
  high_above: "heat",
  gust_over: "wind",
  rain_over: "rain",
  snow_over: "snow",
}

export function addDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** Steps whose local date falls in [from, to], with each step's local date. */
function stepsBetween(series: CellSeries, from: string, to: string, localDate: (ms: number) => string, nowMs: number): { readonly index: number; readonly date: string }[] {
  const start = Date.parse(series.start)
  const steps: { index: number; date: string }[] = []
  for (let i = 0; i < series.tempMaxF.length; i += 1) {
    const ms = start + i * STEP_MS
    if (ms + STEP_MS <= nowMs) continue
    const date = localDate(ms)
    if (date >= from && date <= to) steps.push({ index: i, date })
  }
  return steps
}

/** Rolling 24-hour total ending at each step (amounts). */
function rolling(values: readonly (number | null)[], index: number): number {
  let total = 0
  for (let i = Math.max(0, index - 7); i <= index; i += 1) total += values[i] ?? 0
  return total
}

type Breach = { readonly date: string; readonly value: number }

function firstBreach(series: CellSeries, steps: readonly { index: number; date: string }[], check: WeatherRuleCheck, limit: number): Breach | null {
  let worst: Breach | null = null
  for (const step of steps) {
    const value =
      check === "low_below" ? series.tempMinF[step.index] ?? null
      : check === "high_above" ? series.tempMaxF[step.index] ?? null
      : check === "gust_over" ? series.gustMph[step.index] ?? null
      : check === "rain_over" ? Math.max(0, rolling(series.precipIn, step.index) - rolling(series.snowIn, step.index) / 10)
      : rolling(series.snowIn, step.index)
    if (value === null) continue
    const crossed = check === "low_below" ? value < limit : value > limit
    if (!crossed) continue
    const worse = worst === null || (check === "low_below" ? value < worst.value : value > worst.value)
    if (worst === null) worst = { date: step.date, value }
    else if (worse) worst = { date: worst.date, value }
  }
  return worst
}

function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })
}

function limitText(check: WeatherRuleCheck, limit: number): string {
  if (check === "low_below" || check === "high_above") return `${limit}°F`
  if (check === "gust_over") return `${limit} mph`
  return `${limit} in`
}

function sentence(check: WeatherRuleCheck, value: number, limit: number, date: string, ruleLabel: string | null): string {
  const when = dayLabel(date)
  const rule = ruleLabel ? ` Your limit for ${ruleLabel.toLowerCase()} is ${limitText(check, limit)}.` : ""
  switch (check) {
    case "low_below":
      return `Lows down to ${Math.round(value)}°F starting ${when}.${rule}`
    case "high_above":
      return `Highs up to ${Math.round(value)}°F starting ${when}.${rule}`
    case "gust_over":
      return `Gusts up to ${Math.round(value)} mph starting ${when}.${rule}`
    case "rain_over":
      return `Up to ${value.toFixed(1)} in of rain in 24 hours starting ${when}.${rule}`
    case "snow_over":
      return `Up to ${value.toFixed(value >= 10 ? 0 : 1)} in of snow in 24 hours starting ${when}.${rule}`
  }
}

/**
 * Scheduled items at risk from the site's forecast: each matching work rule
 * over the item's days (plus its days after), and on every item, warnings in
 * effect, heavy snow and extreme cold or heat from the company's limits.
 */
export function scheduleWeatherRisks(input: {
  readonly items: readonly ScheduleItemForRisk[]
  readonly series: CellSeries
  readonly alerts: readonly WeatherAlert[]
  readonly limits: WeatherLimits
  readonly rules: readonly WorkRule[]
  readonly localDate: (ms: number) => string
  readonly nowMs: number
}): ScheduleRisk[] {
  const risks: ScheduleRisk[] = []
  for (const item of input.items) {
    const title = item.title.toLowerCase()
    const seen = new Set<ScheduleRiskKind>()
    for (const rule of input.rules) {
      if (!rule.keywords.some((keyword) => title.includes(keyword.toLowerCase()))) continue
      const steps = stepsBetween(input.series, item.startDate, addDays(item.endDate, rule.daysAfter), input.localDate, input.nowMs)
      const breach = firstBreach(input.series, steps, rule.check, rule.value)
      if (!breach) continue
      const kind = KIND_FOR_CHECK[rule.check]
      seen.add(kind)
      risks.push({ taskId: item.id, taskTitle: item.title, ruleId: rule.id, kind, label: kind.toUpperCase(), detail: sentence(rule.check, breach.value, rule.value, breach.date, rule.label), date: breach.date })
    }
    const steps = stepsBetween(input.series, item.startDate, item.endDate, input.localDate, input.nowMs)
    if (steps.length === 0) continue
    const general: readonly [ScheduleRiskKind, WeatherRuleCheck, number][] = [
      ["snow", "snow_over", input.limits.snowIn],
      ["cold", "low_below", input.limits.coldF + 0.5],
      ["heat", "high_above", input.limits.heatF - 0.5],
    ]
    for (const [kind, check, limit] of general) {
      if (seen.has(kind)) continue
      const breach = firstBreach(input.series, steps, check, limit)
      if (!breach) continue
      risks.push({ taskId: item.id, taskTitle: item.title, ruleId: kind, kind, label: kind.toUpperCase(), detail: sentence(check, breach.value, Math.round(limit), breach.date, null), date: breach.date })
    }
    const first = steps[0]
    const last = steps[steps.length - 1]
    if (!first || !last) continue
    const fromMs = Date.parse(input.series.start) + first.index * STEP_MS
    const toMs = Date.parse(input.series.start) + (last.index + 1) * STEP_MS
    for (const alert of input.alerts) {
      if (alert.level !== "warning" || !alertActiveBetween(alert, fromMs, toMs)) continue
      const onset = alert.onset ? Math.max(Date.parse(alert.onset), fromMs) : fromMs
      risks.push({ taskId: item.id, taskTitle: item.title, ruleId: "warning", kind: "warning", label: "WARNING", detail: alert.headline, date: input.localDate(onset) })
      break
    }
  }
  return risks
}

/**
 * Scheduled items on days when the nearest reporting area's air quality
 * (today's reading or a forecast) reaches the company's AQI limit.
 */
export function scheduleAirRisks(input: {
  readonly items: readonly ScheduleItemForRisk[]
  /** The job's nearest reporting area, or null when none is close. */
  readonly reading: AirReading | null
  readonly aqiLimit: number
  readonly today: string
}): ScheduleRisk[] {
  const reading = input.reading
  if (!reading) return []
  const days = new Map<string, { readonly value: number; readonly text: string }>()
  for (const forecast of reading.forecasts) {
    if (forecast.date < input.today || airValue(forecast) < input.aqiLimit) continue
    const value = forecast.aqi !== null ? `${forecast.aqi} ` : ""
    days.set(forecast.date, { value: airValue(forecast), text: `Air quality forecast ${value}(${AIR_CATEGORY_LABEL[forecast.category]}) on ${dayLabel(forecast.date)} at ${reading.name}.` })
  }
  const now = reading.now
  if (now && now.date === input.today && now.aqi >= input.aqiLimit && (days.get(input.today)?.value ?? 0) < now.aqi) {
    days.set(input.today, { value: now.aqi, text: `Air quality ${now.aqi} (${AIR_CATEGORY_LABEL[now.category]}) at ${reading.name} as of ${airTimeLabel(now.time)}.` })
  }
  const dates = [...days.keys()].sort()
  const risks: ScheduleRisk[] = []
  for (const item of input.items) {
    const date = dates.find((day) => day >= item.startDate && day <= item.endDate)
    const day = date ? days.get(date) : undefined
    if (!date || !day) continue
    risks.push({ taskId: item.id, taskTitle: item.title, ruleId: "air", kind: "air", label: "AIR", detail: `${day.text} Your limit is AQI ${input.aqiLimit}.`, date })
  }
  return risks
}
