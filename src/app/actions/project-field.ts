"use server"

import { and, asc, desc, eq, gte, inArray } from "drizzle-orm"

import { getDb } from "@/db"
import {
  dailyLogPhotos,
  dailyLogs,
  dailyLogTaskLinks,
  ownerProjectUpdates,
  projectExternalLinks,
  projectOperations,
  scheduleTasks,
  projects,
  users,
} from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { normalizeDailyLogNotes } from "@/lib/daily-logs/notes"
import { isDemoUser } from "@/lib/demo"
import { requireOrg } from "@/lib/org-scope"
import {
  dateRangeFromDates,
  isDateWithinOwnerUpdatePeriod,
  isValidOwnerUpdatePeriod,
  parseOwnerUpdateScheduleSnapshot,
  selectRowsByIdOrder,
  serializeOwnerUpdateScheduleSnapshot,
  type OwnerUpdateScheduleItem,
} from "@/lib/owner-updates/snapshot"
import { isOwnerUpdateVisibleToRole } from "@/lib/owner-updates/history"
import { can, requirePermission } from "@/lib/permissions"
import { revalidatePath } from "next/cache"

type LatestDailyLog = {
  readonly id: string
  readonly sourceSystem: string
  readonly logDate: string
  readonly workCompleted: string
  readonly reviewStatus: string
  readonly isClientVisible: boolean
  readonly authorName: string | null
}

type LatestPhoto = {
  readonly id: string
  readonly sourceSystem: string
  readonly fileName: string
  readonly driveFileId: string | null
  readonly driveUrl: string | null
  readonly thumbnailUrl: string | null
  readonly caption: string | null
  readonly reviewStatus: string
  readonly ownerVisible: boolean
  readonly capturedAt: string | null
}

type LatestOwnerUpdate = {
  readonly id: string
  readonly title: string
  readonly updateDate: string
  readonly status: string
  readonly channel: string
  readonly summary: string
}

export type ProjectOwnerUpdateListItem = {
  readonly id: string
  readonly title: string
  readonly updateDate: string
  readonly status: string
  readonly channel: string
  readonly summary: string
  readonly publishedAt: string | null
  readonly sentAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

type OwnerUpdateProject = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
  readonly address: string | null
  readonly clientName: string | null
  readonly projectManager: string | null
}

type OwnerUpdateDailyLog = {
  readonly id: string
  readonly logDate: string
  readonly workCompleted: string
  readonly weather: string | null
  readonly manpower: string | null
  readonly safetyNotes: string | null
  readonly issues: string | null
  readonly nextSteps: string | null
  readonly authorName: string | null
}

type OwnerUpdatePhoto = {
  readonly id: string
  readonly fileName: string
  readonly driveFileId: string | null
  readonly driveUrl: string | null
  readonly thumbnailUrl: string | null
  readonly caption: string | null
  readonly capturedAt: string | null
}

type OwnerUpdatePhotoFolder = {
  readonly label: string
}

type PhotoReviewFolder = {
  readonly label: string
  readonly url: string
  readonly photoCount: number | null
}

type CoordinatePair = {
  readonly latitude: number
  readonly longitude: number
  readonly label: string | null
  readonly query: string
}

export type ProjectDailyLogPhoto = {
  readonly id: string
  readonly fileName: string
  readonly mimeType: string | null
  readonly driveFileId: string | null
  readonly driveUrl: string | null
  readonly thumbnailUrl: string | null
  readonly caption: string | null
  readonly capturedAt: string | null
  readonly reviewStatus: string
  readonly ownerVisible: boolean
  readonly subVendorVisible: boolean
  readonly publicShareable: boolean
}

export type ProjectDailyLogScheduleItem = {
  readonly id: string
  readonly title: string
  readonly startDate: string
  readonly endDate: string
  readonly status: string
  readonly notes: string | null
}

export type ProjectDailyLogTodo = {
  readonly id: string
  readonly title: string
  readonly status: string
  readonly priority: string
  readonly assigneeName: string | null
  readonly companyName: string | null
  readonly dueDate: string | null
}

export type ProjectDailyLogItem = {
  readonly id: string
  readonly sourceSystem: string
  readonly sourceExternalId: string | null
  readonly logDate: string
  readonly weather: string | null
  readonly weatherTempF: number | null
  readonly weatherConditions: string | null
  readonly weatherPrecipitation: string | null
  readonly workCompleted: string
  readonly issues: string | null
  readonly materialsUsed: string | null
  readonly crewPresent: string | null
  readonly hoursWorked: number | null
  readonly safetyIncidents: string | null
  readonly visitorLog: string | null
  readonly notes: string | null
  readonly isClientVisible: boolean
  readonly reviewStatus: string
  readonly syncStatus: string
  readonly authorName: string | null
  readonly photos: readonly ProjectDailyLogPhoto[]
  readonly scheduleItems: readonly ProjectDailyLogScheduleItem[]
  readonly todos: readonly ProjectDailyLogTodo[]
}

export type ProjectDailyLogWorkspace = {
  readonly project: {
    readonly id: string
    readonly name: string
    readonly projectNumber: string | null
    readonly clientName: string | null
  }
  readonly logs: readonly ProjectDailyLogItem[]
  readonly unattachedPhotos: readonly ProjectDailyLogPhoto[]
  readonly schedulePhases: readonly string[]
  readonly counts: {
    readonly totalLogs: number
    readonly approvedLogs: number
    readonly ownerVisibleLogs: number
    readonly totalPhotos: number
    readonly ownerVisiblePhotos: number
    readonly photosAwaitingReview: number
  }
}

type DailyLogReviewInput = {
  readonly dailyLogId: string
  readonly reviewStatus: string
  readonly isClientVisible: boolean
}

type CreateDailyLogInput = {
  readonly logDate: string
  readonly weatherTempF: number | null
  readonly weatherConditions: string
  readonly weatherPrecipitation: string
  readonly workCompleted: string
  readonly issues: string
  readonly materialsUsed: string
  readonly crewPresent: string
  readonly hoursWorked: number | null
  readonly safetyIncidents: string
  readonly visitorLog: string
  readonly notes: string
}

export type ProjectWeatherSnapshot = {
  readonly tempF: number | null
  readonly conditions: string
  readonly precipitation: string | null
  readonly station: string | null
  readonly locationLabel: string | null
  readonly source: string
}

type OwnerUpdateDraftInput = {
  readonly dailyLogIds: readonly string[]
}

export type OwnerUpdateDraftEditInput = {
  readonly title: string
  readonly updateDate: string
  readonly periodStart: string
  readonly periodEnd: string
  readonly summary: string
  readonly selectedPhotoIds: readonly string[]
}

type DailyLogMutationResult =
  | { readonly success: true }
  | { readonly success: false; readonly error: string }

type CreateDailyLogResult =
  | { readonly success: true; readonly dailyLogId: string }
  | { readonly success: false; readonly error: string }

type UpdateDailyLogInput = CreateDailyLogInput & {
  readonly dailyLogId: string
}

type ProjectWeatherSnapshotResult =
  | { readonly success: true; readonly weather: ProjectWeatherSnapshot }
  | { readonly success: false; readonly error: string }

type OwnerUpdateDraftResult =
  | { readonly success: true; readonly updateId: string }
  | { readonly success: false; readonly error: string }

export type OwnerProjectUpdateDocument = {
  readonly canManage: boolean
  readonly project: OwnerUpdateProject
  readonly update: {
    readonly id: string
    readonly title: string
    readonly updateDate: string
    readonly summary: string
    readonly status: string
    readonly channel: string
    readonly publishedAt: string | null
    readonly sentAt: string | null
    readonly sourceDailyLogIds: readonly string[]
    readonly selectedPhotoIds: readonly string[]
    readonly periodStart: string | null
    readonly periodEnd: string | null
  }
  readonly dailyLogs: readonly OwnerUpdateDailyLog[]
  readonly photos: readonly OwnerUpdatePhoto[]
  readonly availablePhotos: readonly OwnerUpdatePhoto[]
  readonly photoFolder: OwnerUpdatePhotoFolder | null
  readonly nextScheduleItem: {
    readonly title: string
    readonly startDate: string
    readonly endDate: string
    readonly assignedTo: string | null
  } | null
  readonly lookAheadScheduleItems: readonly {
    readonly title: string
    readonly startDate: string
    readonly endDate: string
    readonly assignedTo: string | null
  }[]
}

export type ProjectFieldSummary = {
  readonly dailyLogCount: number
  readonly approvedDailyLogCount: number
  readonly clientVisibleDailyLogCount: number
  readonly latestDailyLog: LatestDailyLog | null
  readonly photoCount: number
  readonly photosAwaitingReviewCount: number
  readonly ownerVisiblePhotoCount: number
  readonly latestPhotos: readonly LatestPhoto[]
  readonly photoReviewFolder: PhotoReviewFolder | null
  readonly ownerUpdateCount: number
  readonly draftOwnerUpdateCount: number
  readonly latestOwnerUpdate: LatestOwnerUpdate | null
  readonly nextScheduleItem: {
    readonly title: string
    readonly startDate: string
    readonly endDate: string
    readonly assignedTo: string | null
  } | null
}

function parseIdList(value: string | null): readonly string[] {
  if (!value) return []

  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return [
      ...new Set(
        parsed
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
      ),
    ]
  } catch {
    return []
  }
}

async function captureOwnerUpdateSchedule(
  db: ReturnType<typeof getDb>,
  projectId: string,
  startingOn: string
): Promise<readonly OwnerUpdateScheduleItem[]> {
  return db
    .select({
      title: scheduleTasks.title,
      startDate: scheduleTasks.startDate,
      endDate: scheduleTasks.endDateCalculated,
      assignedTo: scheduleTasks.assignedTo,
    })
    .from(scheduleTasks)
    .where(
      and(
        eq(scheduleTasks.projectId, projectId),
        gte(scheduleTasks.endDateCalculated, startingOn)
      )
    )
    .orderBy(asc(scheduleTasks.startDate), asc(scheduleTasks.sortOrder))
    .limit(8)
}

function isPhotoInOwnerUpdateScope(
  photo: {
    readonly dailyLogId: string | null
    readonly capturedAt: string | null
  },
  sourceDailyLogIds: ReadonlySet<string>,
  periodStart: string,
  periodEnd: string
): boolean {
  if (
    photo.dailyLogId !== null &&
    sourceDailyLogIds.has(photo.dailyLogId)
  ) {
    return true
  }

  const capturedDate = photo.capturedAt?.slice(0, 10) ?? null
  return (
    capturedDate !== null &&
    isDateWithinOwnerUpdatePeriod(capturedDate, periodStart, periodEnd)
  )
}

function ownerFacingDailyLogNotes(value: string | null): string | null {
  const trimmed = value?.trim() ?? ""
  if (trimmed.length === 0) return null
  if (trimmed.startsWith("Buildertrend title:")) return null
  if (trimmed.includes("Buildertrend job ID:")) return null
  return trimmed
}

function photoReviewPhotoCount(value: string | null): number | null {
  if (!value) return null

  try {
    const parsed: unknown = JSON.parse(value)
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "photo_count" in parsed
    ) {
      const count = parsed.photo_count
      return typeof count === "number" ? count : null
    }
    return null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function recordValue(
  value: Record<string, unknown>,
  key: string
): Record<string, unknown> | null {
  const child = value[key]
  return isRecord(child) ? child : null
}

function arrayValue(value: Record<string, unknown>, key: string): readonly unknown[] {
  const child = value[key]
  return Array.isArray(child) ? child : []
}

function stringValue(
  value: Record<string, unknown>,
  key: string
): string | null {
  const child = value[key]
  return typeof child === "string" && child.trim().length > 0
    ? child.trim()
    : null
}

function numberValue(
  value: Record<string, unknown>,
  key: string
): number | null {
  const child = value[key]
  return typeof child === "number" && Number.isFinite(child) ? child : null
}

async function verifyProjectAccess(
  projectId: string
): Promise<ReturnType<typeof getDb>> {
  const user = await requireAuth()
  requirePermission(user, "project", "read")
  const orgId = requireOrg(user)

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  const existing = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
    .limit(1)

  if (!existing[0]) {
    throw new Error("Project not found")
  }

  return db
}

async function verifyProjectMutationAccess(
  projectId: string
): Promise<{
  readonly db: ReturnType<typeof getDb>
  readonly userId: string
}> {
  const user = await requireAuth()
  if (isDemoUser(user.id)) {
    throw new Error("DEMO_READ_ONLY")
  }
  requirePermission(user, "project", "update")
  const orgId = requireOrg(user)

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  const existing = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
    .limit(1)

  if (!existing[0]) {
    throw new Error("Project not found")
  }

  return { db, userId: user.id }
}

function isInternalStaffRole(role: string): boolean {
  switch (role) {
    case "admin":
    case "secondary_admin":
    case "office":
    case "field":
      return true
    default:
      return false
  }
}

async function verifyDailyLogStaffMutationAccess(
  projectId: string
): Promise<{
  readonly db: ReturnType<typeof getDb>
  readonly userId: string
}> {
  const user = await requireAuth()
  if (isDemoUser(user.id)) {
    throw new Error("DEMO_READ_ONLY")
  }
  if (!user.isActive || !isInternalStaffRole(user.role)) {
    throw new Error("Permission denied: staff access is required for daily logs")
  }
  const orgId = requireOrg(user)

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  const existing = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
    .limit(1)

  if (!existing[0]) {
    throw new Error("Project not found")
  }

  return { db, userId: user.id }
}

function displayName(row: {
  readonly displayName: string | null
  readonly firstName: string | null
  readonly lastName: string | null
  readonly email: string | null
}): string | null {
  if (row.displayName) return row.displayName

  const fullName = [row.firstName, row.lastName]
    .filter((part) => part !== null && part.length > 0)
    .join(" ")

  return fullName.length > 0 ? fullName : row.email
}

function normalizedDailyLogReviewStatus(value: string): string {
  switch (value) {
    case "draft":
    case "needs_review":
    case "approved":
    case "rejected":
      return value
    default:
      return "needs_review"
  }
}

function requiredText(value: string, label: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new Error(`${label} is required.`)
  }
  return trimmed
}

function optionalText(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizedLogDate(value: string): string {
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  throw new Error("Enter a valid daily log date.")
}

function addressLooksStateQualified(value: string): boolean {
  return /\b[A-Z]{2}\b/.test(value) || /\bColorado\b/i.test(value)
}

function geocodeQueries(address: string): readonly string[] {
  const trimmed = address.trim()
  if (trimmed.length === 0) return []
  if (addressLooksStateQualified(trimmed)) return [trimmed]
  return [trimmed, `${trimmed}, Colorado`]
}

async function geocodeProjectAddress(
  address: string
): Promise<CoordinatePair | null> {
  for (const query of geocodeQueries(address)) {
    const coordinates = await geocodeWithCensus(query)
    if (coordinates) return coordinates
  }

  for (const query of geocodeQueries(address)) {
    const coordinates = await geocodeWithNominatim(query)
    if (coordinates) return coordinates
  }

  return null
}

async function geocodeWithCensus(
  address: string
): Promise<CoordinatePair | null> {
  const url = new URL(
    "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"
  )
  url.searchParams.set("address", address)
  url.searchParams.set("benchmark", "Public_AR_Current")
  url.searchParams.set("format", "json")

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Compass project management weather lookup",
    },
  })
  if (!response.ok) return null

  const parsed: unknown = await response.json()
  if (!isRecord(parsed)) return null

  const result = recordValue(parsed, "result")
  if (!result) return null

  const matches = arrayValue(result, "addressMatches")
  const firstMatch = matches.find(isRecord)
  if (!firstMatch) return null

  const coordinates = recordValue(firstMatch, "coordinates")
  if (!coordinates) return null

  const longitude = numberValue(coordinates, "x")
  const latitude = numberValue(coordinates, "y")
  if (latitude === null || longitude === null) return null

  const label = stringValue(firstMatch, "matchedAddress")
  return { latitude, longitude, label, query: address }
}

async function geocodeWithNominatim(
  address: string
): Promise<CoordinatePair | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search")
  url.searchParams.set("q", address)
  url.searchParams.set("format", "jsonv2")
  url.searchParams.set("limit", "1")
  url.searchParams.set("countrycodes", "us")

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Compass project management weather lookup",
    },
  })
  if (!response.ok) return null

  const parsed: unknown = await response.json()
  if (!Array.isArray(parsed)) return null

  const firstMatch = parsed.find(isRecord)
  if (!firstMatch) return null

  const latitudeText = stringValue(firstMatch, "lat")
  const longitudeText = stringValue(firstMatch, "lon")
  if (!latitudeText || !longitudeText) return null

  const latitude = Number(latitudeText)
  const longitude = Number(longitudeText)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null

  return {
    latitude,
    longitude,
    label: stringValue(firstMatch, "display_name"),
    query: address,
  }
}

function fahrenheitFromCelsius(value: number | null): number | null {
  if (value === null) return null
  return Math.round((value * 9) / 5 + 32)
}

function inchesFromMeters(value: number | null): string | null {
  if (value === null || value <= 0) return null
  const inches = value * 39.3701
  return `${inches.toFixed(inches < 0.1 ? 2 : 1)} in last hour`
}

function weatherCodeLabel(value: number | null): string {
  switch (value) {
    case 0:
      return "Clear"
    case 1:
    case 2:
    case 3:
      return "Partly cloudy"
    case 45:
    case 48:
      return "Fog"
    case 51:
    case 53:
    case 55:
    case 56:
    case 57:
      return "Drizzle"
    case 61:
    case 63:
    case 65:
    case 66:
    case 67:
      return "Rain"
    case 71:
    case 73:
    case 75:
    case 77:
      return "Snow"
    case 80:
    case 81:
    case 82:
      return "Rain showers"
    case 85:
    case 86:
      return "Snow showers"
    case 95:
    case 96:
    case 99:
      return "Thunderstorm"
    default:
      return "Historical weather"
  }
}

function inchesText(value: number | null, label: string): string | null {
  if (value === null || value <= 0) return null
  return `${value.toFixed(value < 0.1 ? 2 : 1)} in ${label}`
}

function firstNumber(value: Record<string, unknown>, key: string): number | null {
  const child = value[key]
  if (!Array.isArray(child)) return null
  const first = child[0]
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

function isTodayOrFuture(logDate: string): boolean {
  const today = new Date().toISOString().slice(0, 10)
  return logDate >= today
}

function weatherLabel(row: {
  readonly weatherConditions: string | null
  readonly weatherTempF: number | null
  readonly weatherPrecipitation: string | null
}): string | null {
  const parts = [
    row.weatherConditions,
    row.weatherTempF === null ? null : `${row.weatherTempF}F`,
    row.weatherPrecipitation,
  ].filter((part): part is string => part !== null && part.length > 0)

  return parts.length > 0 ? parts.join(", ") : null
}

export async function getProjectFieldSummary(
  projectId: string
): Promise<ProjectFieldSummary> {
  const viewer = await requireAuth()
  const db = await verifyProjectAccess(projectId)
  const today = new Date().toISOString().slice(0, 10)

  const logRows = await db
    .select({
      id: dailyLogs.id,
      sourceSystem: dailyLogs.sourceSystem,
      logDate: dailyLogs.logDate,
      workCompleted: dailyLogs.workCompleted,
      reviewStatus: dailyLogs.reviewStatus,
      isClientVisible: dailyLogs.isClientVisible,
      authorDisplayName: users.displayName,
      authorFirstName: users.firstName,
      authorLastName: users.lastName,
      authorEmail: users.email,
    })
    .from(dailyLogs)
    .leftJoin(users, eq(dailyLogs.authorId, users.id))
    .where(eq(dailyLogs.projectId, projectId))
    .orderBy(desc(dailyLogs.logDate), desc(dailyLogs.createdAt))

  const photoRows = await db
    .select({
      id: dailyLogPhotos.id,
      sourceSystem: dailyLogPhotos.sourceSystem,
      fileName: dailyLogPhotos.fileName,
      mimeType: dailyLogPhotos.mimeType,
      driveFileId: dailyLogPhotos.driveFileId,
      driveUrl: dailyLogPhotos.driveUrl,
      thumbnailUrl: dailyLogPhotos.thumbnailUrl,
      caption: dailyLogPhotos.caption,
      reviewStatus: dailyLogPhotos.reviewStatus,
      ownerVisible: dailyLogPhotos.ownerVisible,
      capturedAt: dailyLogPhotos.capturedAt,
    })
    .from(dailyLogPhotos)
    .where(eq(dailyLogPhotos.projectId, projectId))
    .orderBy(desc(dailyLogPhotos.createdAt))

  const updateRows = await db
    .select({
      id: ownerProjectUpdates.id,
      title: ownerProjectUpdates.title,
      updateDate: ownerProjectUpdates.updateDate,
      status: ownerProjectUpdates.status,
      channel: ownerProjectUpdates.channel,
      summary: ownerProjectUpdates.summary,
    })
    .from(ownerProjectUpdates)
    .where(eq(ownerProjectUpdates.projectId, projectId))
    .orderBy(
      desc(ownerProjectUpdates.updateDate),
      desc(ownerProjectUpdates.createdAt)
    )

  const [nextTask] = await db
    .select({
      title: scheduleTasks.title,
      startDate: scheduleTasks.startDate,
      endDate: scheduleTasks.endDateCalculated,
      assignedTo: scheduleTasks.assignedTo,
    })
    .from(scheduleTasks)
    .where(
      and(
        eq(scheduleTasks.projectId, projectId),
        gte(scheduleTasks.endDateCalculated, today)
      )
    )
    .orderBy(asc(scheduleTasks.startDate), asc(scheduleTasks.sortOrder))
    .limit(1)

  const [photoReviewFolder] = await db
    .select({
      label: projectExternalLinks.label,
      url: projectExternalLinks.externalUrl,
      metadata: projectExternalLinks.metadata,
    })
    .from(projectExternalLinks)
    .where(
      and(
        eq(projectExternalLinks.projectId, projectId),
        eq(projectExternalLinks.system, "google_buildertrend_review_photos")
      )
    )
    .limit(1)

  const latestLog = logRows[0]
  const visibleUpdateRows = updateRows.filter((update) =>
    isOwnerUpdateVisibleToRole(update.status, viewer.role)
  )
  const latestUpdate = visibleUpdateRows[0]
  const thumbnailPhotoRows = photoRows.filter(
    (photo) => photo.thumbnailUrl !== null
  )
  const imagePhotoRows = photoRows.filter(
    (photo) =>
      photo.thumbnailUrl === null && photo.mimeType?.startsWith("image/") === true
  )
  const archivePhotoRows = photoRows.filter(
    (photo) =>
      photo.thumbnailUrl === null &&
      photo.mimeType?.startsWith("image/") !== true
  )
  const latestPhotoRows = [
    ...thumbnailPhotoRows,
    ...imagePhotoRows,
    ...archivePhotoRows,
  ]

  return {
    dailyLogCount: logRows.length,
    approvedDailyLogCount: logRows.filter(
      (log) => log.reviewStatus === "approved"
    ).length,
    clientVisibleDailyLogCount: logRows.filter((log) => log.isClientVisible)
      .length,
    latestDailyLog: latestLog
      ? {
          id: latestLog.id,
          sourceSystem: latestLog.sourceSystem,
          logDate: latestLog.logDate,
          workCompleted: latestLog.workCompleted,
          reviewStatus: latestLog.reviewStatus,
          isClientVisible: latestLog.isClientVisible,
          authorName: displayName({
            displayName: latestLog.authorDisplayName,
            firstName: latestLog.authorFirstName,
            lastName: latestLog.authorLastName,
            email: latestLog.authorEmail,
          }),
        }
      : null,
    photoCount: photoRows.length,
    photosAwaitingReviewCount: photoRows.filter(
      (photo) => photo.reviewStatus === "needs_review"
    ).length,
    ownerVisiblePhotoCount: photoRows.filter((photo) => photo.ownerVisible)
      .length,
    latestPhotos: latestPhotoRows.slice(0, 4).map((photo) => ({
      id: photo.id,
      sourceSystem: photo.sourceSystem,
      fileName: photo.fileName,
      driveFileId: photo.driveFileId,
      driveUrl: photo.driveUrl,
      thumbnailUrl: photo.thumbnailUrl,
      caption: photo.caption,
      reviewStatus: photo.reviewStatus,
      ownerVisible: photo.ownerVisible,
      capturedAt: photo.capturedAt,
    })),
    photoReviewFolder:
      photoReviewFolder?.url !== null && photoReviewFolder?.url !== undefined
        ? {
            label: photoReviewFolder.label,
            url: photoReviewFolder.url,
            photoCount: photoReviewPhotoCount(photoReviewFolder.metadata),
          }
        : null,
    ownerUpdateCount: visibleUpdateRows.length,
    draftOwnerUpdateCount: visibleUpdateRows.filter(
      (update) => update.status === "draft"
    ).length,
    latestOwnerUpdate: latestUpdate
      ? {
          id: latestUpdate.id,
          title: latestUpdate.title,
          updateDate: latestUpdate.updateDate,
          status: latestUpdate.status,
          channel: latestUpdate.channel,
          summary: latestUpdate.summary,
        }
      : null,
    nextScheduleItem: nextTask ?? null,
  }
}

export async function getProjectOwnerUpdates(
  projectId: string
): Promise<readonly ProjectOwnerUpdateListItem[]> {
  const viewer = await requireAuth()
  const db = await verifyProjectAccess(projectId)

  const updateRows = await db
    .select({
      id: ownerProjectUpdates.id,
      title: ownerProjectUpdates.title,
      updateDate: ownerProjectUpdates.updateDate,
      status: ownerProjectUpdates.status,
      channel: ownerProjectUpdates.channel,
      summary: ownerProjectUpdates.summary,
      publishedAt: ownerProjectUpdates.publishedAt,
      sentAt: ownerProjectUpdates.sentAt,
      createdAt: ownerProjectUpdates.createdAt,
      updatedAt: ownerProjectUpdates.updatedAt,
    })
    .from(ownerProjectUpdates)
    .where(eq(ownerProjectUpdates.projectId, projectId))
    .orderBy(
      desc(ownerProjectUpdates.updateDate),
      desc(ownerProjectUpdates.createdAt)
    )

  return updateRows.filter((update) =>
    isOwnerUpdateVisibleToRole(update.status, viewer.role)
  )
}

export async function getProjectDailyLogWorkspace(
  projectId: string
): Promise<ProjectDailyLogWorkspace> {
  const db = await verifyProjectAccess(projectId)

  const [project] = await db
    .select({
      id: projects.id,
      name: projects.name,
      projectNumber: projects.projectNumber,
      clientName: projects.clientName,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  if (!project) {
    throw new Error("Project not found")
  }

  const logRows = await db
    .select({
      id: dailyLogs.id,
      sourceSystem: dailyLogs.sourceSystem,
      sourceExternalId: dailyLogs.sourceExternalId,
      logDate: dailyLogs.logDate,
      weatherTempF: dailyLogs.weatherTempF,
      weatherConditions: dailyLogs.weatherConditions,
      weatherPrecipitation: dailyLogs.weatherPrecipitation,
      workCompleted: dailyLogs.workCompleted,
      issues: dailyLogs.issues,
      materialsUsed: dailyLogs.materialsUsed,
      crewPresent: dailyLogs.crewPresent,
      hoursWorked: dailyLogs.hoursWorked,
      safetyIncidents: dailyLogs.safetyIncidents,
      visitorLog: dailyLogs.visitorLog,
      notes: dailyLogs.notes,
      isClientVisible: dailyLogs.isClientVisible,
      reviewStatus: dailyLogs.reviewStatus,
      syncStatus: dailyLogs.syncStatus,
      authorDisplayName: users.displayName,
      authorFirstName: users.firstName,
      authorLastName: users.lastName,
      authorEmail: users.email,
    })
    .from(dailyLogs)
    .leftJoin(users, eq(dailyLogs.authorId, users.id))
    .where(eq(dailyLogs.projectId, projectId))
    .orderBy(desc(dailyLogs.logDate), desc(dailyLogs.createdAt))

  const photoRows = await db
    .select({
      id: dailyLogPhotos.id,
      dailyLogId: dailyLogPhotos.dailyLogId,
      fileName: dailyLogPhotos.fileName,
      mimeType: dailyLogPhotos.mimeType,
      driveFileId: dailyLogPhotos.driveFileId,
      driveUrl: dailyLogPhotos.driveUrl,
      thumbnailUrl: dailyLogPhotos.thumbnailUrl,
      caption: dailyLogPhotos.caption,
      capturedAt: dailyLogPhotos.capturedAt,
      reviewStatus: dailyLogPhotos.reviewStatus,
      ownerVisible: dailyLogPhotos.ownerVisible,
      subVendorVisible: dailyLogPhotos.subVendorVisible,
      publicShareable: dailyLogPhotos.publicShareable,
      createdAt: dailyLogPhotos.createdAt,
    })
    .from(dailyLogPhotos)
    .where(eq(dailyLogPhotos.projectId, projectId))
    .orderBy(asc(dailyLogPhotos.sortOrder), desc(dailyLogPhotos.createdAt))

  const phaseRows = await db
    .select({ phase: scheduleTasks.phase })
    .from(scheduleTasks)
    .where(eq(scheduleTasks.projectId, projectId))
    .orderBy(asc(scheduleTasks.sortOrder), asc(scheduleTasks.startDate))

  const schedulePhases = [
    ...new Set(
      phaseRows
        .map((row) => row.phase.trim())
        .filter((phase) => phase.length > 0)
    ),
  ]

  const logIds = logRows.map((row) => row.id)
  const taskRows =
    logIds.length === 0
      ? []
      : await db
          .select({
            dailyLogId: dailyLogTaskLinks.dailyLogId,
            id: scheduleTasks.id,
            title: scheduleTasks.title,
            startDate: scheduleTasks.startDate,
            endDate: scheduleTasks.endDateCalculated,
            status: scheduleTasks.status,
            notes: dailyLogTaskLinks.notes,
          })
          .from(dailyLogTaskLinks)
          .innerJoin(
            scheduleTasks,
            eq(dailyLogTaskLinks.scheduleTaskId, scheduleTasks.id)
          )
          .where(inArray(dailyLogTaskLinks.dailyLogId, logIds))
          .orderBy(asc(scheduleTasks.startDate), asc(scheduleTasks.sortOrder))

  const todoRows =
    logIds.length === 0
      ? []
      : await db
          .select({
            sourceRecordId: projectOperations.sourceRecordId,
            id: projectOperations.id,
            title: projectOperations.title,
            status: projectOperations.status,
            priority: projectOperations.priority,
            assigneeName: projectOperations.assigneeName,
            companyName: projectOperations.companyName,
            dueDate: projectOperations.dueDate,
          })
          .from(projectOperations)
          .where(
            and(
              eq(projectOperations.projectId, projectId),
              inArray(projectOperations.sourceRecordId, logIds),
              inArray(projectOperations.sourceRecordType, [
                "staff_task",
                "subcontractor_task",
                "supplier_task",
                "schedule_task",
              ])
            )
          )
          .orderBy(asc(projectOperations.dueDate), asc(projectOperations.title))

  const photosByLogId = new Map<string, ProjectDailyLogPhoto[]>()
  const unattachedPhotos: ProjectDailyLogPhoto[] = []

  for (const row of photoRows) {
    const photo = {
      id: row.id,
      fileName: row.fileName,
      mimeType: row.mimeType,
      driveFileId: row.driveFileId,
      driveUrl: row.driveUrl,
      thumbnailUrl: row.thumbnailUrl,
      caption: row.caption,
      capturedAt: row.capturedAt,
      reviewStatus: row.reviewStatus,
      ownerVisible: row.ownerVisible,
      subVendorVisible: row.subVendorVisible,
      publicShareable: row.publicShareable,
    }

    if (row.dailyLogId === null) {
      unattachedPhotos.push(photo)
    } else {
      photosByLogId.set(row.dailyLogId, [
        ...(photosByLogId.get(row.dailyLogId) ?? []),
        photo,
      ])
    }
  }

  const scheduleItemsByLogId = new Map<
    string,
    ProjectDailyLogScheduleItem[]
  >()
  for (const row of taskRows) {
    scheduleItemsByLogId.set(row.dailyLogId, [
      ...(scheduleItemsByLogId.get(row.dailyLogId) ?? []),
      {
        id: row.id,
        title: row.title,
        startDate: row.startDate,
        endDate: row.endDate,
        status: row.status,
        notes: row.notes,
      },
    ])
  }

  const todosByLogId = new Map<string, ProjectDailyLogTodo[]>()
  for (const row of todoRows) {
    if (!row.sourceRecordId) continue

    todosByLogId.set(row.sourceRecordId, [
      ...(todosByLogId.get(row.sourceRecordId) ?? []),
      {
        id: row.id,
        title: row.title,
        status: row.status,
        priority: row.priority,
        assigneeName: row.assigneeName,
        companyName: row.companyName,
        dueDate: row.dueDate,
      },
    ])
  }

  return {
    project,
    logs: logRows.map((row) => ({
      id: row.id,
      sourceSystem: row.sourceSystem,
      sourceExternalId: row.sourceExternalId,
      logDate: row.logDate,
      weather: weatherLabel({
        weatherConditions: row.weatherConditions,
        weatherTempF: row.weatherTempF,
        weatherPrecipitation: row.weatherPrecipitation,
      }),
      weatherTempF: row.weatherTempF,
      weatherConditions: row.weatherConditions,
      weatherPrecipitation: row.weatherPrecipitation,
      workCompleted: row.workCompleted,
      issues: row.issues,
      materialsUsed: row.materialsUsed,
      crewPresent: row.crewPresent,
      hoursWorked: row.hoursWorked,
      safetyIncidents: row.safetyIncidents,
      visitorLog: row.visitorLog,
      notes: normalizeDailyLogNotes(row.workCompleted, row.notes),
      isClientVisible: row.isClientVisible,
      reviewStatus: row.reviewStatus,
      syncStatus: row.syncStatus,
      authorName: displayName({
        displayName: row.authorDisplayName,
        firstName: row.authorFirstName,
        lastName: row.authorLastName,
        email: row.authorEmail,
      }),
      photos: photosByLogId.get(row.id) ?? [],
      scheduleItems: scheduleItemsByLogId.get(row.id) ?? [],
      todos: todosByLogId.get(row.id) ?? [],
    })),
    unattachedPhotos,
    schedulePhases,
    counts: {
      totalLogs: logRows.length,
      approvedLogs: logRows.filter((row) => row.reviewStatus === "approved")
        .length,
      ownerVisibleLogs: logRows.filter((row) => row.isClientVisible).length,
      totalPhotos: photoRows.length,
      ownerVisiblePhotos: photoRows.filter((row) => row.ownerVisible).length,
      photosAwaitingReview: photoRows.filter(
        (row) => row.reviewStatus === "needs_review"
      ).length,
    },
  }
}

export async function createProjectDailyLog(
  projectId: string,
  input: CreateDailyLogInput
): Promise<CreateDailyLogResult> {
  try {
    const { db, userId } = await verifyDailyLogStaffMutationAccess(projectId)
    const dailyLogId = crypto.randomUUID()
    const now = new Date().toISOString()
    const logDate = normalizedLogDate(input.logDate)
    const workCompleted = requiredText(input.workCompleted, "Work completed")

    await db.insert(dailyLogs).values({
      id: dailyLogId,
      projectId,
      authorId: userId,
      sourceSystem: "compass",
      sourceExternalId: null,
      logDate,
      weatherTempF: input.weatherTempF,
      weatherConditions: optionalText(input.weatherConditions),
      weatherPrecipitation: optionalText(input.weatherPrecipitation),
      weatherSource: "manual",
      workCompleted,
      issues: optionalText(input.issues),
      materialsUsed: optionalText(input.materialsUsed),
      crewPresent: optionalText(input.crewPresent),
      hoursWorked: input.hoursWorked,
      safetyIncidents: optionalText(input.safetyIncidents),
      visitorLog: optionalText(input.visitorLog),
      notes: normalizeDailyLogNotes(workCompleted, input.notes),
      isClientVisible: false,
      reviewStatus: "needs_review",
      tags: null,
      syncStatus: "pending",
      createdAt: now,
      updatedAt: now,
    })

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/daily-logs`)
    revalidatePath(`/dashboard/projects/${projectId}/owner-updates`)

    return { success: true, dailyLogId }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Unable to create daily log.",
    }
  }
}

export async function updateProjectDailyLog(
  projectId: string,
  input: UpdateDailyLogInput
): Promise<DailyLogMutationResult> {
  try {
    const { db } = await verifyDailyLogStaffMutationAccess(projectId)
    const dailyLogId = input.dailyLogId.trim()

    if (dailyLogId.length === 0) {
      return { success: false, error: "Daily log is required." }
    }

    const [existing] = await db
      .select({ id: dailyLogs.id })
      .from(dailyLogs)
      .where(and(eq(dailyLogs.id, dailyLogId), eq(dailyLogs.projectId, projectId)))
      .limit(1)

    if (!existing) {
      return { success: false, error: "Daily log not found." }
    }

    const logDate = normalizedLogDate(input.logDate)
    const workCompleted = requiredText(input.workCompleted, "Work completed")

    await db
      .update(dailyLogs)
      .set({
        logDate,
        weatherTempF: input.weatherTempF,
        weatherConditions: optionalText(input.weatherConditions),
        weatherPrecipitation: optionalText(input.weatherPrecipitation),
        weatherSource: "manual",
        workCompleted,
        issues: optionalText(input.issues),
        materialsUsed: optionalText(input.materialsUsed),
        crewPresent: optionalText(input.crewPresent),
        hoursWorked: input.hoursWorked,
        safetyIncidents: optionalText(input.safetyIncidents),
        visitorLog: optionalText(input.visitorLog),
        notes: normalizeDailyLogNotes(workCompleted, input.notes),
        isClientVisible: false,
        reviewStatus: "needs_review",
        syncStatus: "pending",
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(dailyLogs.id, dailyLogId), eq(dailyLogs.projectId, projectId)))

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/daily-logs`)
    revalidatePath(`/dashboard/projects/${projectId}/owner-updates`)

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Unable to update daily log.",
    }
  }
}

export async function getProjectWeatherSnapshot(
  projectId: string,
  input?: { readonly logDate?: string }
): Promise<ProjectWeatherSnapshotResult> {
  try {
    const db = await verifyProjectAccess(projectId)
    const [project] = await db
      .select({
        address: projects.address,
        name: projects.name,
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

    const coordinates = await geocodeProjectAddress(address)
    if (!coordinates) {
      return {
        success: false,
        error: `Could not match the project address to weather coordinates. Address tried: ${address}.`,
      }
    }

    const logDate =
      input?.logDate && input.logDate.trim().length > 0
        ? normalizedLogDate(input.logDate)
        : new Date().toISOString().slice(0, 10)
    const weather = isTodayOrFuture(logDate)
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
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Unable to pull project weather.",
    }
  }
}

export async function updateDailyLogReview(
  projectId: string,
  input: DailyLogReviewInput
): Promise<DailyLogMutationResult> {
  try {
    const { db } = await verifyProjectMutationAccess(projectId)
    const dailyLogId = input.dailyLogId.trim()

    if (dailyLogId.length === 0) {
      return { success: false, error: "Daily log is required." }
    }

    const [existing] = await db
      .select({ id: dailyLogs.id })
      .from(dailyLogs)
      .where(and(eq(dailyLogs.id, dailyLogId), eq(dailyLogs.projectId, projectId)))
      .limit(1)

    if (!existing) {
      return { success: false, error: "Daily log not found." }
    }

    await db
      .update(dailyLogs)
      .set({
        reviewStatus: normalizedDailyLogReviewStatus(input.reviewStatus),
        isClientVisible: input.isClientVisible,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(dailyLogs.id, dailyLogId), eq(dailyLogs.projectId, projectId)))

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/daily-logs`)

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Unable to update daily log.",
    }
  }
}

export async function draftOwnerUpdateFromDailyLogs(
  projectId: string,
  input: OwnerUpdateDraftInput
): Promise<OwnerUpdateDraftResult> {
  try {
    const { db, userId } = await verifyProjectMutationAccess(projectId)
    const dailyLogIds = [...new Set(input.dailyLogIds)].filter(
      (id) => id.trim().length > 0
    )

    if (dailyLogIds.length === 0) {
      return { success: false, error: "Select at least one daily log." }
    }

    const [project] = await db
      .select({
        id: projects.id,
        name: projects.name,
        projectNumber: projects.projectNumber,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)

    if (!project) {
      return { success: false, error: "Project not found." }
    }

    const selectedLogs = await db
      .select({
        id: dailyLogs.id,
        logDate: dailyLogs.logDate,
        workCompleted: dailyLogs.workCompleted,
        notes: dailyLogs.notes,
      })
      .from(dailyLogs)
      .where(
        and(
          eq(dailyLogs.projectId, projectId),
          inArray(dailyLogs.id, dailyLogIds),
          eq(dailyLogs.reviewStatus, "approved"),
          eq(dailyLogs.isClientVisible, true)
        )
      )
      .orderBy(asc(dailyLogs.logDate), asc(dailyLogs.createdAt))

    if (selectedLogs.length !== dailyLogIds.length) {
      return {
        success: false,
        error:
          "Every selected daily log must be approved and owner-visible before drafting.",
      }
    }

    const ownerPhotos = await db
      .select({ id: dailyLogPhotos.id })
      .from(dailyLogPhotos)
      .where(
        and(
          eq(dailyLogPhotos.projectId, projectId),
          inArray(dailyLogPhotos.dailyLogId, selectedLogs.map((log) => log.id)),
          eq(dailyLogPhotos.reviewStatus, "approved"),
          eq(dailyLogPhotos.ownerVisible, true)
        )
      )
      .orderBy(asc(dailyLogPhotos.sortOrder), asc(dailyLogPhotos.createdAt))

    const firstLog = selectedLogs[0]
    const lastLog = selectedLogs[selectedLogs.length - 1]
    if (firstLog === undefined || lastLog === undefined) {
      return { success: false, error: "Selected daily logs were not found." }
    }
    const label = project.projectNumber ?? project.name
    const title =
      firstLog.logDate === lastLog.logDate
        ? `${label} Update - ${firstLog.logDate}`
        : `${label} Update - ${firstLog.logDate} to ${lastLog.logDate}`
    const summary = selectedLogs
      .map((log) => log.workCompleted)
      .join(" ")
      .slice(0, 900)
    const updateId = crypto.randomUUID()
    const now = new Date().toISOString()
    const scheduleSnapshot = await captureOwnerUpdateSchedule(
      db,
      projectId,
      lastLog.logDate
    )

    await db.insert(ownerProjectUpdates).values({
      id: updateId,
      projectId,
      createdBy: userId,
      title,
      updateDate: lastLog.logDate,
      summary,
      status: "draft",
      channel: "compass",
      sourceDailyLogIds: JSON.stringify(selectedLogs.map((log) => log.id)),
      selectedPhotoIds: JSON.stringify(ownerPhotos.map((photo) => photo.id)),
      periodStart: firstLog.logDate,
      periodEnd: lastLog.logDate,
      scheduleSnapshot:
        serializeOwnerUpdateScheduleSnapshot(scheduleSnapshot),
      createdAt: now,
      updatedAt: now,
    })

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/daily-logs`)
    revalidatePath(`/dashboard/projects/${projectId}/owner-updates/${updateId}`)

    return { success: true, updateId }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to draft owner update.",
    }
  }
}

export async function getOwnerProjectUpdateDocument(
  projectId: string,
  updateId: string
): Promise<OwnerProjectUpdateDocument> {
  const viewer = await requireAuth()
  const db = await verifyProjectAccess(projectId)

  const [project] = await db
    .select({
      id: projects.id,
      name: projects.name,
      projectNumber: projects.projectNumber,
      address: projects.address,
      clientName: projects.clientName,
      projectManager: projects.projectManager,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  const [update] = await db
    .select({
      id: ownerProjectUpdates.id,
      projectId: ownerProjectUpdates.projectId,
      title: ownerProjectUpdates.title,
      updateDate: ownerProjectUpdates.updateDate,
      summary: ownerProjectUpdates.summary,
      status: ownerProjectUpdates.status,
      channel: ownerProjectUpdates.channel,
      sourceDailyLogIds: ownerProjectUpdates.sourceDailyLogIds,
      selectedPhotoIds: ownerProjectUpdates.selectedPhotoIds,
      periodStart: ownerProjectUpdates.periodStart,
      periodEnd: ownerProjectUpdates.periodEnd,
      scheduleSnapshot: ownerProjectUpdates.scheduleSnapshot,
      publishedAt: ownerProjectUpdates.publishedAt,
      sentAt: ownerProjectUpdates.sentAt,
    })
    .from(ownerProjectUpdates)
    .where(
      and(
        eq(ownerProjectUpdates.id, updateId),
        eq(ownerProjectUpdates.projectId, projectId)
      )
    )
    .limit(1)

  if (!project || !update) {
    throw new Error("Owner update not found")
  }
  if (!isOwnerUpdateVisibleToRole(update.status, viewer.role)) {
    throw new Error("Owner update not found")
  }

  const selectedDailyLogIds = parseIdList(update.sourceDailyLogIds)
  const selectedPhotoIds = parseIdList(update.selectedPhotoIds)

  const allLogRows = await db
    .select({
      id: dailyLogs.id,
      logDate: dailyLogs.logDate,
      workCompleted: dailyLogs.workCompleted,
      weatherTempF: dailyLogs.weatherTempF,
      weatherConditions: dailyLogs.weatherConditions,
      crewPresent: dailyLogs.crewPresent,
      safetyIncidents: dailyLogs.safetyIncidents,
      issues: dailyLogs.issues,
      notes: dailyLogs.notes,
      authorDisplayName: users.displayName,
      authorFirstName: users.firstName,
      authorLastName: users.lastName,
      authorEmail: users.email,
    })
    .from(dailyLogs)
    .leftJoin(users, eq(dailyLogs.authorId, users.id))
    .where(
      and(
        eq(dailyLogs.projectId, projectId),
        eq(dailyLogs.reviewStatus, "approved"),
        eq(dailyLogs.isClientVisible, true)
      )
    )
    .orderBy(asc(dailyLogs.logDate), asc(dailyLogs.createdAt))

  const allPhotoRows = await db
    .select({
      id: dailyLogPhotos.id,
      dailyLogId: dailyLogPhotos.dailyLogId,
      fileName: dailyLogPhotos.fileName,
      driveFileId: dailyLogPhotos.driveFileId,
      driveUrl: dailyLogPhotos.driveUrl,
      thumbnailUrl: dailyLogPhotos.thumbnailUrl,
      mimeType: dailyLogPhotos.mimeType,
      caption: dailyLogPhotos.caption,
      capturedAt: dailyLogPhotos.capturedAt,
      ownerVisible: dailyLogPhotos.ownerVisible,
      reviewStatus: dailyLogPhotos.reviewStatus,
    })
    .from(dailyLogPhotos)
    .where(eq(dailyLogPhotos.projectId, projectId))
    .orderBy(asc(dailyLogPhotos.sortOrder), asc(dailyLogPhotos.createdAt))

  const [photoFolder] = await db
    .select({
      label: projectExternalLinks.label,
    })
    .from(projectExternalLinks)
    .where(
      and(
        eq(projectExternalLinks.projectId, projectId),
        eq(projectExternalLinks.system, "google_progress_photos_folder")
      )
    )
    .limit(1)

  const dailyLogIds = new Set(selectedDailyLogIds)
  const photoIds = new Set(selectedPhotoIds)
  const lookAheadTasks =
    parseOwnerUpdateScheduleSnapshot(update.scheduleSnapshot)
  const dailyLogsForUpdate = selectRowsByIdOrder(
    allLogRows,
    selectedDailyLogIds
  )
    .filter((row) =>
      isDateWithinOwnerUpdatePeriod(
        row.logDate,
        update.periodStart,
        update.periodEnd
      )
    )
    .map((row) => ({
      id: row.id,
      logDate: row.logDate,
      workCompleted: row.workCompleted,
      weather: [
        row.weatherConditions,
        row.weatherTempF === null ? null : `${row.weatherTempF}F`,
      ]
        .filter((part) => part !== null && part.length > 0)
        .join(", ") || null,
      manpower: row.crewPresent,
      safetyNotes: row.safetyIncidents,
      issues: row.issues,
      nextSteps: ownerFacingDailyLogNotes(
        normalizeDailyLogNotes(row.workCompleted, row.notes)
      ),
      authorName: displayName({
        displayName: row.authorDisplayName,
        firstName: row.authorFirstName,
        lastName: row.authorLastName,
        email: row.authorEmail,
      }),
    }))

  const eligiblePhotoRows = allPhotoRows
    .filter((row) => {
      const isImage =
        row.thumbnailUrl !== null || row.mimeType?.startsWith("image/") === true
      return isImage && row.ownerVisible && row.reviewStatus === "approved"
    })

  const photosForUpdate = selectRowsByIdOrder(
    eligiblePhotoRows,
    selectedPhotoIds
  )
    .map((row) => ({
      id: row.id,
      fileName: row.fileName,
      driveUrl: row.driveUrl,
      driveFileId: row.driveFileId,
      thumbnailUrl: row.thumbnailUrl,
      caption: row.caption,
      capturedAt: row.capturedAt,
    }))

  const selectedEligiblePhotoRows = selectRowsByIdOrder(
    eligiblePhotoRows,
    selectedPhotoIds
  )
  const scopedUnselectedPhotoRows = eligiblePhotoRows.filter(
    (row) =>
      !photoIds.has(row.id) &&
      update.periodStart !== null &&
      update.periodEnd !== null &&
      isPhotoInOwnerUpdateScope(
        row,
        dailyLogIds,
        update.periodStart,
        update.periodEnd
      )
  )
  const availablePhotos = [
    ...selectedEligiblePhotoRows,
    ...scopedUnselectedPhotoRows,
  ]
    .slice(0, 80)
    .map((row) => ({
      id: row.id,
      fileName: row.fileName,
      driveUrl: row.driveUrl,
      driveFileId: row.driveFileId,
      thumbnailUrl: row.thumbnailUrl,
      caption: row.caption,
      capturedAt: row.capturedAt,
    }))

  return {
    canManage: can(viewer, "project", "update"),
    project,
    update: {
      id: update.id,
      title: update.title,
      updateDate: update.updateDate,
      summary: update.summary,
      status: update.status,
      channel: update.channel,
      publishedAt: update.publishedAt,
      sentAt: update.sentAt,
      sourceDailyLogIds: selectedDailyLogIds,
      selectedPhotoIds,
      periodStart: update.periodStart,
      periodEnd: update.periodEnd,
    },
    dailyLogs: dailyLogsForUpdate,
    photos: photosForUpdate,
    availablePhotos,
    photoFolder:
      photoFolder
        ? {
            label: photoFolder.label,
          }
        : null,
    nextScheduleItem: lookAheadTasks[0] ?? null,
    lookAheadScheduleItems: lookAheadTasks,
  }
}

export async function updateOwnerProjectUpdateDraft(
  projectId: string,
  updateId: string,
  input: OwnerUpdateDraftEditInput
): Promise<
  | { readonly success: true }
  | { readonly success: false; readonly error: string }
> {
  try {
    const { db } = await verifyProjectMutationAccess(projectId)
    const title = input.title.trim()
    const updateDate = input.updateDate.trim()
    const periodStart = input.periodStart.trim()
    const periodEnd = input.periodEnd.trim()
    const summary = input.summary.trim()
    const selectedPhotoIds = [...new Set(input.selectedPhotoIds)]
      .map((id) => id.trim())
      .filter((id) => id.length > 0)

    if (title.length === 0) {
      return { success: false, error: "Title is required." }
    }
    if (!isValidOwnerUpdatePeriod(updateDate, updateDate)) {
      return { success: false, error: "Enter a valid update date." }
    }
    if (!isValidOwnerUpdatePeriod(periodStart, periodEnd)) {
      return {
        success: false,
        error: "The reporting period must have valid start and end dates.",
      }
    }
    if (summary.length === 0) {
      return { success: false, error: "Summary is required." }
    }

    const [update] = await db
      .select({
        id: ownerProjectUpdates.id,
        status: ownerProjectUpdates.status,
        sourceDailyLogIds: ownerProjectUpdates.sourceDailyLogIds,
      })
      .from(ownerProjectUpdates)
      .where(
        and(
          eq(ownerProjectUpdates.id, updateId),
          eq(ownerProjectUpdates.projectId, projectId)
        )
      )
      .limit(1)

    if (!update) {
      return { success: false, error: "Owner update not found." }
    }
    if (update.status === "published") {
      return {
        success: false,
        error: "Published owner updates cannot be edited here.",
      }
    }

    const sourceDailyLogIds = parseIdList(update.sourceDailyLogIds)
    if (sourceDailyLogIds.length > 0) {
      const eligibleLogs = await db
        .select({
          id: dailyLogs.id,
          logDate: dailyLogs.logDate,
        })
        .from(dailyLogs)
        .where(
          and(
            eq(dailyLogs.projectId, projectId),
            inArray(dailyLogs.id, sourceDailyLogIds),
            eq(dailyLogs.reviewStatus, "approved"),
            eq(dailyLogs.isClientVisible, true)
          )
        )

      if (eligibleLogs.length !== sourceDailyLogIds.length) {
        return {
          success: false,
          error:
            "Every source daily log must remain approved and owner-visible.",
        }
      }

      if (
        eligibleLogs.some(
          (log) =>
            !isDateWithinOwnerUpdatePeriod(
              log.logDate,
              periodStart,
              periodEnd
            )
        )
      ) {
        return {
          success: false,
          error: "The reporting period must include every source daily log.",
        }
      }
    }

    if (selectedPhotoIds.length > 0) {
      const eligiblePhotos = await db
        .select({
          id: dailyLogPhotos.id,
          dailyLogId: dailyLogPhotos.dailyLogId,
          capturedAt: dailyLogPhotos.capturedAt,
        })
        .from(dailyLogPhotos)
        .where(
          and(
            eq(dailyLogPhotos.projectId, projectId),
            inArray(dailyLogPhotos.id, selectedPhotoIds),
            eq(dailyLogPhotos.ownerVisible, true),
            eq(dailyLogPhotos.reviewStatus, "approved")
          )
        )

      if (eligiblePhotos.length !== selectedPhotoIds.length) {
        return {
          success: false,
          error: "Only approved owner-visible photos can be selected.",
        }
      }

      const sourceDailyLogIdSet = new Set(sourceDailyLogIds)
      if (
        eligiblePhotos.some(
          (photo) =>
            !isPhotoInOwnerUpdateScope(
              photo,
              sourceDailyLogIdSet,
              periodStart,
              periodEnd
            )
        )
      ) {
        return {
          success: false,
          error:
            "Selected photos must be tied to a source log or captured during the reporting period.",
        }
      }
    }

    const scheduleSnapshot = await captureOwnerUpdateSchedule(
      db,
      projectId,
      periodEnd
    )

    await db
      .update(ownerProjectUpdates)
      .set({
        title,
        updateDate,
        periodStart,
        periodEnd,
        summary,
        selectedPhotoIds: JSON.stringify(selectedPhotoIds),
        scheduleSnapshot:
          serializeOwnerUpdateScheduleSnapshot(scheduleSnapshot),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(ownerProjectUpdates.id, updateId))

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/owner-updates`)
    revalidatePath(
      `/dashboard/projects/${projectId}/owner-updates/${updateId}`
    )

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to update owner draft.",
    }
  }
}

export async function publishOwnerProjectUpdate(
  projectId: string,
  updateId: string
): Promise<
  | { readonly success: true }
  | { readonly success: false; readonly error: string }
> {
  const user = await requireAuth()
  requirePermission(user, "project", "update")
  const orgId = requireOrg(user)

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)

  const [update] = await db
    .select({
      id: ownerProjectUpdates.id,
      projectId: ownerProjectUpdates.projectId,
      status: ownerProjectUpdates.status,
      title: ownerProjectUpdates.title,
      updateDate: ownerProjectUpdates.updateDate,
      summary: ownerProjectUpdates.summary,
      sourceDailyLogIds: ownerProjectUpdates.sourceDailyLogIds,
      selectedPhotoIds: ownerProjectUpdates.selectedPhotoIds,
      periodStart: ownerProjectUpdates.periodStart,
      periodEnd: ownerProjectUpdates.periodEnd,
    })
    .from(ownerProjectUpdates)
    .innerJoin(projects, eq(ownerProjectUpdates.projectId, projects.id))
    .where(
      and(
        eq(ownerProjectUpdates.id, updateId),
        eq(ownerProjectUpdates.projectId, projectId),
        eq(projects.organizationId, orgId)
      )
    )
    .limit(1)

  if (!update) {
    return { success: false, error: "Owner update not found" }
  }

  if (update.status === "published") {
    return { success: true }
  }

  if (
    update.title.trim().length === 0 ||
    update.summary.trim().length === 0 ||
    !isValidOwnerUpdatePeriod(update.updateDate, update.updateDate)
  ) {
    return {
      success: false,
      error: "Complete the title, update date, and summary before publishing.",
    }
  }

  const sourceDailyLogIds = parseIdList(update.sourceDailyLogIds)
  const selectedPhotoIds = parseIdList(update.selectedPhotoIds)
  const eligibleLogs =
    sourceDailyLogIds.length === 0
      ? []
      : await db
          .select({
            id: dailyLogs.id,
            logDate: dailyLogs.logDate,
          })
          .from(dailyLogs)
          .where(
            and(
              eq(dailyLogs.projectId, projectId),
              inArray(dailyLogs.id, sourceDailyLogIds),
              eq(dailyLogs.reviewStatus, "approved"),
              eq(dailyLogs.isClientVisible, true)
            )
          )

  if (eligibleLogs.length !== sourceDailyLogIds.length) {
    return {
      success: false,
      error:
        "Every source daily log must be approved and owner-visible before publishing.",
    }
  }

  const derivedPeriod = dateRangeFromDates(
    eligibleLogs.map((log) => log.logDate)
  )
  const periodStart =
    update.periodStart ?? derivedPeriod?.startDate ?? update.updateDate
  const periodEnd =
    update.periodEnd ?? derivedPeriod?.endDate ?? update.updateDate

  if (!isValidOwnerUpdatePeriod(periodStart, periodEnd)) {
    return {
      success: false,
      error: "Set a valid reporting period before publishing.",
    }
  }

  if (
    eligibleLogs.some(
      (log) =>
        !isDateWithinOwnerUpdatePeriod(
          log.logDate,
          periodStart,
          periodEnd
        )
    )
  ) {
    return {
      success: false,
      error: "The reporting period must include every source daily log.",
    }
  }

  if (selectedPhotoIds.length > 0) {
    const eligiblePhotos = await db
      .select({
        id: dailyLogPhotos.id,
        dailyLogId: dailyLogPhotos.dailyLogId,
        capturedAt: dailyLogPhotos.capturedAt,
      })
      .from(dailyLogPhotos)
      .where(
        and(
          eq(dailyLogPhotos.projectId, projectId),
          inArray(dailyLogPhotos.id, selectedPhotoIds),
          eq(dailyLogPhotos.ownerVisible, true),
          eq(dailyLogPhotos.reviewStatus, "approved")
        )
      )

    if (eligiblePhotos.length !== selectedPhotoIds.length) {
      return {
        success: false,
        error:
          "Every selected photo must remain approved and owner-visible before publishing.",
      }
    }

    const sourceDailyLogIdSet = new Set(sourceDailyLogIds)
    if (
      eligiblePhotos.some(
        (photo) =>
          !isPhotoInOwnerUpdateScope(
            photo,
            sourceDailyLogIdSet,
            periodStart,
            periodEnd
          )
      )
    ) {
      return {
        success: false,
        error:
          "Selected photos must be tied to a source log or captured during the reporting period.",
      }
    }
  }

  const scheduleSnapshot = await captureOwnerUpdateSchedule(
    db,
    projectId,
    periodEnd
  )
  const now = new Date().toISOString()

  await db
    .update(ownerProjectUpdates)
    .set({
      status: "published",
      periodStart,
      periodEnd,
      sourceDailyLogIds: JSON.stringify(sourceDailyLogIds),
      selectedPhotoIds: JSON.stringify(selectedPhotoIds),
      scheduleSnapshot:
        serializeOwnerUpdateScheduleSnapshot(scheduleSnapshot),
      publishedAt: now,
      updatedAt: now,
    })
    .where(eq(ownerProjectUpdates.id, updateId))

  revalidatePath(`/dashboard/projects/${projectId}`)
  revalidatePath(
    `/dashboard/projects/${projectId}/owner-updates/${updateId}`
  )

  return { success: true }
}
