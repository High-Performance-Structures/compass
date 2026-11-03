/**
 * A daily log's weather from the job site's forecast: the high as the
 * temperature, "Snow, low 6F, gusts 40 mph" as the conditions, and the day's
 * rain or snow. Warnings, smoke and poor air at the site are added on the day
 * they are in effect.
 */
import type { WeatherFlag } from "@/lib/weather/layer"
import type { SiteWeatherDay } from "@/lib/weather/schedule-risk-server"

export type ForecastLogWeather = {
  readonly tempF: number | null
  readonly conditions: string
  readonly precipitation: string
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

function precipitationText(day: SiteWeatherDay): string {
  const parts = [
    day.snowIn >= 0.1 ? `${day.snowIn.toFixed(1)} in snow` : null,
    day.rainIn >= 0.01 ? `${day.rainIn.toFixed(2)} in rain` : null,
  ].filter((part): part is string => part !== null)
  return parts.length > 0 ? `${parts.join(", ")} forecast` : "None forecast"
}

export function forecastLogWeather(day: SiteWeatherDay, hazards: readonly WeatherFlag[]): ForecastLogWeather {
  const parts = [
    skyWord(day),
    day.lowF === null ? null : `low ${day.lowF}F`,
    day.gustMph !== null && day.gustMph >= GUST_MENTION_MPH ? `gusts ${day.gustMph} mph` : null,
    ...hazards.map(hazardText),
  ].filter((part): part is string => part !== null)
  return { tempF: day.highF, conditions: parts.join(", "), precipitation: precipitationText(day) }
}
