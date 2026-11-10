/**
 * A daily log's weather line: the high as the temperature, "Snow, low 6F,
 * gusts 40 mph" as the conditions, and the day's rain or snow. Today and the
 * next two days come from the job site's forecast, with warnings, smoke and
 * poor air added on the day they are in effect; past days use what was
 * recorded, in the same shape.
 */
import type { WeatherFlag } from "@/lib/weather/layer"
import type { SiteWeatherDay } from "@/lib/weather/schedule-risk-server"

export type LogWeather = {
  readonly tempF: number | null
  readonly conditions: string
  readonly precipitation: string
}

/** A past day's recorded weather at the site. */
export type RecordedWeatherDay = {
  /** "Clear", "Drizzle", ... from the recorded weather code. */
  readonly sky: string
  readonly highF: number | null
  readonly lowF: number | null
  readonly rainIn: number
  readonly snowIn: number
  readonly gustMph: number | null
}

/** Gusts below this are left out of the line. */
const GUST_MENTION_MPH = 15

function skyWord(day: SiteWeatherDay): string {
  const snow = day.snowIn >= 0.1
  const rain = day.rainIn >= 0.01
  if (snow && rain) return "Rain and snow"
  if (snow) return "Snow"
  if (rain) return "Rain"
  return "Dry"
}

/** "WINTER STORM WARNING" → "Winter Storm Warning"; "AQI 162" stays. */
function titleCase(label: string): string {
  return label
    .split(" ")
    .map((word) => (word === "AQI" ? word : word.charAt(0) + word.slice(1).toLowerCase()))
    .join(" ")
}

function hazardText(flag: WeatherFlag): string | null {
  switch (flag.kind) {
    case "warning":
    case "red_flag":
    case "smoke":
    case "air":
      return titleCase(flag.label)
    default:
      return null
  }
}

function precipitationText(day: { readonly snowIn: number; readonly rainIn: number }, verb: "forecast" | "recorded"): string {
  const parts = [
    day.snowIn >= 0.1 ? `${day.snowIn.toFixed(1)} in snow` : null,
    day.rainIn >= 0.01 ? `${day.rainIn.toFixed(2)} in rain` : null,
  ].filter((part): part is string => part !== null)
  return parts.length > 0 ? `${parts.join(", ")} ${verb}` : verb === "forecast" ? "None forecast" : "None recorded"
}

function conditionsText(sky: string, lowF: number | null, gustMph: number | null, extra: readonly (string | null)[]): string {
  return [
    sky,
    lowF === null ? null : `low ${lowF}F`,
    gustMph !== null && gustMph >= GUST_MENTION_MPH ? `gusts ${gustMph} mph` : null,
    ...extra,
  ]
    .filter((part): part is string => part !== null)
    .join(", ")
}

export function forecastLogWeather(day: SiteWeatherDay, hazards: readonly WeatherFlag[]): LogWeather {
  return {
    tempF: day.highF,
    conditions: conditionsText(skyWord(day), day.lowF, day.gustMph, hazards.map(hazardText)),
    precipitation: precipitationText(day, "forecast"),
  }
}

export function recordedLogWeather(day: RecordedWeatherDay): LogWeather {
  return {
    tempF: day.highF,
    conditions: conditionsText(day.sky, day.lowF, day.gustMph, []),
    precipitation: precipitationText(day, "recorded"),
  }
}
