import { z } from "zod/v4"
import { SMOKE_LEVELS } from "@/lib/weather/air"
import { DEFAULT_WEATHER_LIMITS } from "@/lib/weather/layer"
import { DEFAULT_WEATHER_WORK_RULES, WEATHER_RULE_CHECKS } from "@/lib/weather/schedule-risk"

/** Company settings for Settings › Workflows › Weather & fire alerts. */
/**
 * A weather rule for scheduled work: items whose title contains one of the
 * keywords are checked against one forecast limit over their days (plus
 * `daysAfter`, e.g. concrete curing).
 */
const weatherWorkRuleSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().trim().min(1).max(80),
  keywords: z.array(z.string().trim().min(2).max(40)).min(1).max(20),
  check: z.enum(WEATHER_RULE_CHECKS),
  value: z.number().min(-60).max(130),
  daysAfter: z.number().int().min(0).max(7),
})

/**
 * Weather & fire alerts: the limits that flag a job on the map's Weather and
 * Fire & smoke layers. Forecasts are for each job site's own grid cell.
 */
export const weatherAlertSettingsSchema = z.object({
  /** Snow in 24 hours, inches. */
  snowIn: z.number().min(0.5).max(48),
  /** Rain in 24 hours, inches. */
  rainIn: z.number().min(0.1).max(10),
  gustMph: z.number().int().min(10).max(120),
  /** Extreme cold: a low at or below this, °F. */
  coldF: z.number().int().min(-60).max(50),
  /** Extreme heat: a high at or above this, °F. */
  heatF: z.number().int().min(60).max(130),
  /** An active wildfire within this many miles of a job. */
  fireMiles: z.number().int().min(1).max(200),
  /** Air quality: an AQI at or above this, now or forecast, near a job. */
  aqi: z.number().int().min(51).max(500),
  /** Smoke over a job at this density or heavier. */
  smokeLevel: z.enum(SMOKE_LEVELS),
  /** Rules for scheduled work; every item is also checked for warnings, heavy snow and extreme cold or heat. */
  workRules: z.array(weatherWorkRuleSchema).max(20),
  /** Notify the item's assignee and the job's project administrators when a scheduled item is at risk. */
  notifyScheduleRisks: z.boolean(),
})

export type WeatherAlertSettings = z.infer<typeof weatherAlertSettingsSchema>

export const DEFAULT_WEATHER_ALERT_SETTINGS: WeatherAlertSettings = {
  ...DEFAULT_WEATHER_LIMITS,
  workRules: DEFAULT_WEATHER_WORK_RULES.map((rule) => ({ ...rule, keywords: [...rule.keywords] })),
  notifyScheduleRisks: true,
}
