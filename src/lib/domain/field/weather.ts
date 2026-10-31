/**
 * Weather for a daily log: live National Weather Service observations for
 * today, the Open-Meteo archive for past dates.
 */
import { eq } from "drizzle-orm"

import { projects } from "@/db/schema"
import { addressState, geocodeProjectAddress, type CoordinatePair, type GeocodeResult } from "@/lib/geo/site-lookup"
import { resolveTown } from "@/lib/portfolio-map/model"
import { placeIndexResolver } from "@/lib/portfolio-map/places-server"
import { readPortfolioMapRules } from "@/lib/portfolio-map/rules-server"
import { DEFAULT_MAP_STATE } from "@/lib/portfolio-map/states"
import type { Db } from "@/lib/server/action-context"
import { isRecord } from "@/lib/shared/guards"

import {
  fahrenheitFromCelsius,
  inchesFromMeters,
  inchesText,
  isTodayOrFuture,
  normalizedLogDate,
  optionalText,
  weatherCodeLabel,
} from "./rules"

type ProjectWeatherSnapshot = {
  readonly tempF: number | null
  readonly conditions: string
  readonly precipitation: string | null
  readonly station: string | null
  readonly locationLabel: string | null
  readonly source: string
}

export type ProjectWeatherSnapshotResult =
  | { readonly success: true; readonly weather: ProjectWeatherSnapshot }
  | { readonly success: false; readonly error: string }

type JsonRecord = Readonly<Record<string, unknown>>

function recordValue(value: JsonRecord, key: string): JsonRecord | null {
  const child = value[key]
  return isRecord(child) ? child : null
}

function arrayValue(value: JsonRecord, key: string): readonly unknown[] {
  const child = value[key]
  return Array.isArray(child) ? child : []
}

function stringValue(value: JsonRecord, key: string): string | null {
  const child = value[key]
  return typeof child === "string" && child.trim().length > 0
    ? child.trim()
    : null
}

function numberValue(value: JsonRecord, key: string): number | null {
  const child = value[key]
  return typeof child === "number" && Number.isFinite(child) ? child : null
}

function firstNumber(value: JsonRecord, key: string): number | null {
  const child = value[key]
  if (!Array.isArray(child)) return null
  const first: unknown = child[0]
  return typeof first === "number" && Number.isFinite(first) ? first : null
}

async function fetchProjectWeather(
  coordinates: CoordinatePair
): Promise<ProjectWeatherSnapshot | null> {
  const pointUrl = `https://api.weather.gov/points/${coordinates.latitude.toFixed(
    4
  )},${coordinates.longitude.toFixed(4)}`
  const headers = {
    Accept: "application/geo+json",
    "User-Agent": "Compass project management weather lookup",
  }
  const pointResponse = await fetch(pointUrl, { headers })
  if (!pointResponse.ok) return null

  const pointParsed: unknown = await pointResponse.json()
  if (!isRecord(pointParsed)) return null

  const pointProperties = recordValue(pointParsed, "properties")
  const stationsUrl = pointProperties
    ? stringValue(pointProperties, "observationStations")
    : null
  if (!stationsUrl) return null

  const stationsResponse = await fetch(stationsUrl, { headers })
  if (!stationsResponse.ok) return null

  const stationsParsed: unknown = await stationsResponse.json()
  if (!isRecord(stationsParsed)) return null

  const stationFeature = arrayValue(stationsParsed, "features").find(isRecord)
  const stationProperties = stationFeature
    ? recordValue(stationFeature, "properties")
    : null
  const stationId = stationProperties
    ? stringValue(stationProperties, "stationIdentifier")
    : null
  if (!stationId) return null

  const observationResponse = await fetch(
    `https://api.weather.gov/stations/${stationId}/observations/latest`,
    { headers }
  )
  if (!observationResponse.ok) return null

  const observationParsed: unknown = await observationResponse.json()
  if (!isRecord(observationParsed)) return null

  const observationProperties = recordValue(observationParsed, "properties")
  if (!observationProperties) return null

  const temperature = recordValue(observationProperties, "temperature")
  const precipitation = recordValue(
    observationProperties,
    "precipitationLastHour"
  )
  const conditions = stringValue(observationProperties, "textDescription")

  return {
    tempF: fahrenheitFromCelsius(
      temperature ? numberValue(temperature, "value") : null
    ),
    conditions: conditions ?? "Observed weather",
    precipitation: inchesFromMeters(
      precipitation ? numberValue(precipitation, "value") : null
    ),
    station: stationId,
    locationLabel: coordinates.label ?? coordinates.query,
    source: "National Weather Service",
  }
}

async function fetchHistoricalProjectWeather(
  coordinates: CoordinatePair,
  logDate: string
): Promise<ProjectWeatherSnapshot | null> {
  const url = new URL("https://archive-api.open-meteo.com/v1/archive")
  url.searchParams.set("latitude", coordinates.latitude.toFixed(4))
  url.searchParams.set("longitude", coordinates.longitude.toFixed(4))
  url.searchParams.set("start_date", logDate)
  url.searchParams.set("end_date", logDate)
  url.searchParams.set(
    "daily",
    [
      "weather_code",
      "temperature_2m_mean",
      "precipitation_sum",
      "rain_sum",
      "snowfall_sum",
    ].join(",")
  )
  url.searchParams.set("temperature_unit", "fahrenheit")
  url.searchParams.set("precipitation_unit", "inch")
  url.searchParams.set("timezone", "America/Denver")

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Compass project management weather lookup",
    },
  })
  if (!response.ok) return null

  const parsed: unknown = await response.json()
  if (!isRecord(parsed)) return null

  const daily = recordValue(parsed, "daily")
  if (!daily) return null

  const tempF = firstNumber(daily, "temperature_2m_mean")
  const precipitation = firstNumber(daily, "precipitation_sum")
  const rain = firstNumber(daily, "rain_sum")
  const snow = firstNumber(daily, "snowfall_sum")
  const weatherCode = firstNumber(daily, "weather_code")
  const precipitationParts = [
    inchesText(precipitation, "precipitation"),
    inchesText(rain, "rain"),
    inchesText(snow, "snow"),
  ].filter((part): part is string => part !== null)

  return {
    tempF: tempF === null ? null : Math.round(tempF),
    conditions: weatherCodeLabel(weatherCode),
    precipitation:
      precipitationParts.length > 0 ? precipitationParts.join(", ") : "None recorded",
    station: null,
    locationLabel: coordinates.label ?? coordinates.query,
    source: "Open-Meteo historical archive",
  }
}

function located(result: GeocodeResult): CoordinatePair | null {
  return result.status === "found" ? result.coordinates : null
}

/** Weather at the project's address on the log date (today when blank). */
export async function projectWeatherSnapshot(
  db: Db,
  projectId: string,
  requestedLogDate: string | undefined
): Promise<ProjectWeatherSnapshotResult> {
  const [project] = await db
    .select({
      address: projects.address,
      name: projects.name,
      organizationId: projects.organizationId,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  if (!project) {
    return { success: false, error: "Project not found." }
  }

  const address = optionalText(project.address ?? "")
  if (!address) {
    return {
      success: false,
      error: "Add a project address before pulling automatic weather.",
    }
  }

  // Weather is regional, so a town or ZIP center stands in for a rural
  // address the geocoders don't know.
  // Addresses without a state are in the company's map state.
  const homeState = project.organizationId
    ? (await readPortfolioMapRules(db, project.organizationId)).mapState
    : DEFAULT_MAP_STATE
  const places = (await placeIndexResolver([address], homeState))(address)
  const town = resolveTown({ publicLocationCity: null, address, name: project.name }, places)
  const townState = addressState(address) ?? homeState
  const coordinates =
    located(await geocodeProjectAddress(address, homeState, places)) ??
    (town
      ? { latitude: town.lat, longitude: town.lon, label: `${town.town}, ${townState} (town center)`, query: address, precision: "town" }
      : null)
  if (!coordinates) {
    return {
      success: false,
      error: `Could not match the project address to weather coordinates. Address tried: ${address}.`,
    }
  }

  const today = new Date().toISOString().slice(0, 10)
  const logDate =
    requestedLogDate && requestedLogDate.trim().length > 0
      ? normalizedLogDate(requestedLogDate)
      : today
  const weather = isTodayOrFuture(logDate, today)
    ? await fetchProjectWeather(coordinates)
    : await fetchHistoricalProjectWeather(coordinates, logDate)
  if (!weather) {
    return {
      success: false,
      error: `Weather service did not return weather for ${logDate}. Location tried: ${
        coordinates.label ?? coordinates.query
      }.`,
    }
  }

  return { success: true, weather }
}
