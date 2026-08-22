"use server"

import { and, asc, desc, eq, gte, inArray } from "drizzle-orm"

import { getDb } from "@/db"
import {
  dailyLogPhotos,
  dailyLogs,
  dailyLogTaskLinks,
  ownerProjectUpdates,
  projectExternalLinks,
  projectMembers,
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
  parseOwnerUpdateComposerSnapshot,
  reconcileSubmittedScheduleSelections,
  selectRowsByIdOrder,
  serializeOwnerUpdateComposerSnapshot,
  type OwnerUpdateComposerSnapshot,
  type OwnerUpdateDocumentSelection,
  type OwnerUpdateScheduleSelection,
  type OwnerUpdateTodoSelection,
} from "@/lib/owner-updates/snapshot"
import {
  buildOwnerUpdateDraftPrompt,
  cleanOwnerUpdateDraft,
  defaultOwnerUpdatePeriod,
  isCompletedScheduleCandidate,
  isLookAheadScheduleCandidate,
  ownerUpdateTodoTiming,
} from "@/lib/owner-updates/composer"
import { isOwnerUpdateVisibleToRole } from "@/lib/owner-updates/history"
import { retainSelectedAndScopedRows } from "@/lib/owner-updates/photo-selection"
import { ownerUpdateIdBatches } from "@/lib/owner-updates/query-batches"
import { can } from "@/lib/permissions"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import { assertProjectAccess } from "@/lib/project-access"
import { canUseProjectAudience } from "@/lib/project-audience-access"
import {
  PROJECT_TODO_RECORD_TYPES,
  isArchivedProjectTodoStatus,
} from "@/lib/project-todos"
import {
  isJarvisAgentBridgeEnabled,
  relayAgentRequest,
} from "@/lib/jarvis/agent-relay"
import { isInternalStaffRole } from "@/lib/user-roles"
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
  readonly sourceSystem: string
  readonly logDate: string
  readonly workCompleted: string
  readonly weather: string | null
  readonly manpower: string | null
  readonly safetyNotes: string | null
  readonly issues: string | null
  readonly nextSteps: string | null
  readonly authorName: string | null
  readonly reviewStatus: string
  readonly isClientVisible: boolean
}

type OwnerUpdatePhoto = {
  readonly id: string
  readonly sourceSystem: string
  readonly fileName: string
  readonly mimeType: string | null
  readonly driveFileId: string | null
  readonly driveUrl: string | null
  readonly thumbnailUrl: string | null
  readonly caption: string | null
  readonly capturedAt: string | null
  readonly reviewStatus: string
  readonly ownerVisible: boolean
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
  readonly clientSubmissionId?: string
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
  readonly sourceDailyLogIds: readonly string[]
  readonly selectedPhotoIds: readonly string[]
  readonly selectedDocumentIds: readonly string[]
  readonly completedScheduleItems: readonly OwnerUpdateScheduleSelection[]
  readonly lookAheadScheduleItems: readonly OwnerUpdateScheduleSelection[]
  readonly todos: readonly OwnerUpdateTodoSelection[]
}

type DailyLogMutationResult =
  | { readonly success: true }
  | { readonly success: false; readonly error: string }

type CreateDailyLogResult =
  | { readonly success: true; readonly dailyLogId: string }
  | { readonly success: false; readonly error: string }

type UpdateDailyLogInput = CreateDailyLogInput & {
  readonly dailyLogId: string
  readonly targetProjectId: string
}

type UpdateDailyLogResult =
  | { readonly success: true; readonly projectId: string }
  | { readonly success: false; readonly error: string }

type ProjectWeatherSnapshotResult =
  | { readonly success: true; readonly weather: ProjectWeatherSnapshot }
  | { readonly success: false; readonly error: string }

type OwnerUpdateDraftResult =
  | { readonly success: true; readonly updateId: string }
  | { readonly success: false; readonly error: string }

export type OwnerProjectUpdateDocument = {
  readonly canManage: boolean
  readonly viewerId: string
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
    readonly recalledAt: string | null
    readonly updatedAt: string
    readonly sourceDailyLogIds: readonly string[]
    readonly selectedPhotoIds: readonly string[]
    readonly selectedDocumentIds: readonly string[]
    readonly periodStart: string | null
    readonly periodEnd: string | null
  }
  readonly dailyLogs: readonly OwnerUpdateDailyLog[]
  readonly availableDailyLogs: readonly OwnerUpdateDailyLog[]
  readonly photos: readonly OwnerUpdatePhoto[]
  readonly availablePhotos: readonly OwnerUpdatePhoto[]
  readonly documents: readonly OwnerUpdateDocumentSelection[]
  readonly availableDocuments: readonly OwnerUpdateDocumentSelection[]
  readonly photoFolder: OwnerUpdatePhotoFolder | null
  readonly nextScheduleItem: {
    readonly title: string
    readonly startDate: string
    readonly endDate: string
    readonly assignedTo: string | null
  } | null
  readonly lookAheadScheduleItems: readonly {
    readonly id: string
    readonly title: string
    readonly startDate: string
    readonly endDate: string
    readonly assignedTo: string | null
    readonly status: string
    readonly percentComplete: number
    readonly notes: string
  }[]
  readonly completedScheduleItems: readonly OwnerUpdateScheduleSelection[]
  readonly availableCompletedScheduleItems: readonly OwnerUpdateScheduleSelection[]
  readonly availableLookAheadScheduleItems: readonly OwnerUpdateScheduleSelection[]
  readonly todos: readonly OwnerUpdateTodoSelection[]
  readonly availableTodos: readonly OwnerUpdateTodoSelection[]
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

async function getOwnerUpdateComposerCandidates(
  db: ReturnType<typeof getDb>,
  projectId: string,
  periodStart: string,
  periodEnd: string
): Promise<{
  readonly completedScheduleItems: readonly OwnerUpdateScheduleSelection[]
  readonly lookAheadScheduleItems: readonly OwnerUpdateScheduleSelection[]
  readonly todos: readonly OwnerUpdateTodoSelection[]
}> {
  const [scheduleRows, todoRows] = await Promise.all([
    db
      .select({
        id: scheduleTasks.id,
        title: scheduleTasks.title,
        startDate: scheduleTasks.startDate,
        endDate: scheduleTasks.endDateCalculated,
        assignedTo: scheduleTasks.assignedTo,
        status: scheduleTasks.status,
        percentComplete: scheduleTasks.percentComplete,
      })
      .from(scheduleTasks)
      .where(eq(scheduleTasks.projectId, projectId))
      .orderBy(asc(scheduleTasks.startDate), asc(scheduleTasks.sortOrder)),
    db
      .select({
        id: projectOperations.id,
        title: projectOperations.title,
        description: projectOperations.description,
        status: projectOperations.status,
        priority: projectOperations.priority,
        assigneeName: projectOperations.assigneeName,
        companyName: projectOperations.companyName,
        dueDate: projectOperations.dueDate,
        sourceRecordType: projectOperations.sourceRecordType,
      })
      .from(projectOperations)
      .where(
        and(
          eq(projectOperations.projectId, projectId),
          inArray(projectOperations.sourceRecordType, [
            ...PROJECT_TODO_RECORD_TYPES,
          ])
        )
      )
      .orderBy(asc(projectOperations.dueDate), asc(projectOperations.title)),
  ])

  const scheduleSelections = scheduleRows.map((item) => ({
    ...item,
    notes: "",
  }))
  const completedScheduleItems = scheduleSelections
    .filter((item) =>
      isCompletedScheduleCandidate(item, periodStart, periodEnd)
    )
    .slice(0, 20)
  const lookAheadScheduleItems = scheduleSelections
    .filter((item) => isLookAheadScheduleCandidate(item, periodEnd))
    .slice(0, 20)
  const todos = todoRows.flatMap((item) => {
    if (isArchivedProjectTodoStatus(item.status)) return []
    const timing = ownerUpdateTodoTiming(item.dueDate, periodStart, periodEnd)
    if (timing === null) return []
    return [
      {
        id: item.id,
        title: item.title,
        description: item.description ?? "",
        status: item.status,
        priority: item.priority,
        assigneeName: item.assigneeName,
        companyName: item.companyName,
        dueDate: item.dueDate,
        timing,
        notes: "",
      },
    ]
  })

  return {
    completedScheduleItems,
    lookAheadScheduleItems,
    todos,
  }
}

function ownerUpdateDocumentSelection(
  row: {
    readonly id: string
    readonly sourceSystem: string
    readonly fileName: string
    readonly mimeType: string | null
    readonly driveFileId: string | null
    readonly driveUrl: string | null
    readonly caption: string | null
    readonly capturedAt: string | null
  }
): OwnerUpdateDocumentSelection {
  return {
    id: row.id,
    sourceSystem: row.sourceSystem,
    fileName: row.fileName,
    mimeType: row.mimeType,
    driveFileId: row.driveFileId,
    driveUrl: row.driveUrl,
    caption: row.caption,
    capturedAt: row.capturedAt,
  }
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
  projectId: string,
  featureId: string = "daily-logs"
): Promise<ReturnType<typeof getDb>> {
  const user = await requireAuth()
  await requireFeaturePermission(user, featureId, "read")
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

async function verifyOwnerUpdateReadAccess(projectId: string): Promise<{
  readonly db: ReturnType<typeof getDb>
  readonly viewer: Awaited<ReturnType<typeof requireAuth>>
}> {
  const viewer = await requireAuth()
  await requireFeaturePermission(viewer, "owner-updates", "read")
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  await assertProjectAccess(db, viewer, projectId)
  if (!isInternalStaffRole(viewer.role)) {
    const membership = await db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, viewer.id)
        )
      )
      .get()
    if (!canUseProjectAudience(membership?.role ?? null, "owner")) {
      throw new Error("Project not found")
    }
  }
  return { db, viewer }
}

async function verifyProjectMutationAccess(
  projectId: string,
  featureId: string = "daily-logs"
): Promise<{
  readonly db: ReturnType<typeof getDb>
  readonly userId: string
  readonly user: Awaited<ReturnType<typeof requireAuth>>
}> {
  const user = await requireAuth()
  if (isDemoUser(user.id)) {
    throw new Error("DEMO_READ_ONLY")
  }
  await requireFeaturePermission(user, featureId, "update")
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

  return { db, userId: user.id, user }
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
  await requireFeaturePermission(user, "daily-logs", "update")
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
  const { db, viewer } = await verifyOwnerUpdateReadAccess(projectId)

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

export async function getOwnerUpdateProjectHeader(projectId: string): Promise<{
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
}> {
  const { db } = await verifyOwnerUpdateReadAccess(projectId)
  const project = await db
    .select({
      id: projects.id,
      name: projects.name,
      projectNumber: projects.projectNumber,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
    .get()
  if (!project) throw new Error("Project not found")
  return project
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
            dailyLogs,
            eq(dailyLogTaskLinks.dailyLogId, dailyLogs.id)
          )
          .innerJoin(
            scheduleTasks,
            eq(dailyLogTaskLinks.scheduleTaskId, scheduleTasks.id)
          )
          .where(eq(dailyLogs.projectId, projectId))
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
          .innerJoin(
            dailyLogs,
            and(
              eq(projectOperations.sourceRecordId, dailyLogs.id),
              eq(dailyLogs.projectId, projectId)
            )
          )
          .where(
            and(
              eq(projectOperations.projectId, projectId),
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
    const clientSubmissionId = input.clientSubmissionId?.trim()
    const dailyLogId = clientSubmissionId || crypto.randomUUID()

    // Native Field Mode retries after interrupted requests. Reusing the client
    // UUID prevents a successful first request from creating a duplicate log.
    if (clientSubmissionId) {
      const [existing] = await db
        .select({ projectId: dailyLogs.projectId, authorId: dailyLogs.authorId })
        .from(dailyLogs)
        .where(eq(dailyLogs.id, dailyLogId))
        .limit(1)

      if (existing) {
        return existing.projectId === projectId && existing.authorId === userId
          ? { success: true, dailyLogId }
          : { success: false, error: "Daily log submission ID is already in use." }
      }
    }
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
): Promise<UpdateDailyLogResult> {
  try {
    const { db } = await verifyDailyLogStaffMutationAccess(projectId)
    const dailyLogId = input.dailyLogId.trim()
    const targetProjectId = input.targetProjectId.trim()

    if (dailyLogId.length === 0) {
      return { success: false, error: "Daily log is required." }
    }
    if (targetProjectId.length === 0) {
      return { success: false, error: "Project is required." }
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
    const now = new Date().toISOString()

    if (targetProjectId !== projectId) {
      await verifyDailyLogStaffMutationAccess(targetProjectId)

      const attachedPhotoRows = await db
        .select({ id: dailyLogPhotos.id })
        .from(dailyLogPhotos)
        .where(eq(dailyLogPhotos.dailyLogId, dailyLogId))
      const attachedPhotoIds = new Set(
        attachedPhotoRows.map((photo) => photo.id)
      )
      const updateRows = await db
        .select({
          title: ownerProjectUpdates.title,
          sourceDailyLogIds: ownerProjectUpdates.sourceDailyLogIds,
          selectedPhotoIds: ownerProjectUpdates.selectedPhotoIds,
        })
        .from(ownerProjectUpdates)
        .where(eq(ownerProjectUpdates.projectId, projectId))
      const referencedUpdate = updateRows.find(
        (update) =>
          parseIdList(update.sourceDailyLogIds).includes(dailyLogId) ||
          parseIdList(update.selectedPhotoIds).some((photoId) =>
            attachedPhotoIds.has(photoId)
          )
      )

      if (referencedUpdate) {
        return {
          success: false,
          error: `Remove this log and its photos from "${referencedUpdate.title}" before changing projects.`,
        }
      }

      await db
        .update(dailyLogPhotos)
        .set({
          projectId: targetProjectId,
          reviewStatus: "needs_review",
          ownerVisible: false,
          subVendorVisible: false,
          updatedAt: now,
        })
        .where(
          and(
            eq(dailyLogPhotos.projectId, projectId),
            eq(dailyLogPhotos.dailyLogId, dailyLogId)
          )
        )

      await db
        .update(projectOperations)
        .set({
          projectId: targetProjectId,
          updatedAt: now,
        })
        .where(
          and(
            eq(projectOperations.projectId, projectId),
            eq(projectOperations.sourceRecordId, dailyLogId)
          )
        )

      // Schedule items belong to a specific project, so their association
      // cannot safely follow a daily log that moves to another project.
      await db
        .delete(dailyLogTaskLinks)
        .where(eq(dailyLogTaskLinks.dailyLogId, dailyLogId))
    }

    await db
      .update(dailyLogs)
      .set({
        projectId: targetProjectId,
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
        updatedAt: now,
      })
      .where(and(eq(dailyLogs.id, dailyLogId), eq(dailyLogs.projectId, projectId)))

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/daily-logs`)
    revalidatePath(`/dashboard/projects/${projectId}/owner-updates`)
    if (targetProjectId !== projectId) {
      revalidatePath(`/dashboard/projects/${targetProjectId}`)
      revalidatePath(`/dashboard/projects/${targetProjectId}/daily-logs`)
      revalidatePath(
        `/dashboard/projects/${targetProjectId}/owner-updates`
      )
    }

    return { success: true, projectId: targetProjectId }
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
    const { db, userId } = await verifyProjectMutationAccess(
      projectId,
      "owner-updates"
    )
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
          inArray(dailyLogs.id, dailyLogIds)
        )
      )
      .orderBy(asc(dailyLogs.logDate), asc(dailyLogs.createdAt))

    if (selectedLogs.length !== dailyLogIds.length) {
      return {
        success: false,
        error: "One or more selected daily logs could not be found.",
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
    const composerCandidates = await getOwnerUpdateComposerCandidates(
      db,
      projectId,
      firstLog.logDate,
      lastLog.logDate
    )
    const scheduleSnapshot = serializeOwnerUpdateComposerSnapshot({
      version: 2,
      ...composerCandidates,
      documents: [],
    })

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
      scheduleSnapshot,
      createdAt: now,
      updatedAt: now,
    })

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/daily-logs`)
    revalidatePath(`/dashboard/projects/${projectId}/owner-updates`)
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

export async function createManualOwnerProjectUpdateDraft(
  projectId: string,
  updateDate: string
): Promise<OwnerUpdateDraftResult> {
  try {
    const { db, userId } = await verifyProjectMutationAccess(
      projectId,
      "owner-updates"
    )
    const normalizedDate = updateDate.trim()
    if (!isValidOwnerUpdatePeriod(normalizedDate, normalizedDate)) {
      return { success: false, error: "Enter a valid update date." }
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

    const updateId = crypto.randomUUID()
    const now = new Date().toISOString()
    const label = project.projectNumber ?? project.name
    const defaultPeriod = defaultOwnerUpdatePeriod(normalizedDate)
    const composerCandidates = await getOwnerUpdateComposerCandidates(
      db,
      projectId,
      defaultPeriod.startDate,
      normalizedDate
    )
    const scheduleSnapshot = serializeOwnerUpdateComposerSnapshot({
      version: 2,
      ...composerCandidates,
      documents: [],
    })

    await db.insert(ownerProjectUpdates).values({
      id: updateId,
      projectId,
      createdBy: userId,
      title: `${label} Owner Update - ${normalizedDate}`,
      updateDate: normalizedDate,
      summary: "",
      status: "draft",
      channel: "compass",
      sourceDailyLogIds: "[]",
      selectedPhotoIds: "[]",
      periodStart: defaultPeriod.startDate,
      periodEnd: normalizedDate,
      scheduleSnapshot,
      createdAt: now,
      updatedAt: now,
    })

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/owner-updates`)
    revalidatePath(`/dashboard/projects/${projectId}/owner-updates/${updateId}`)

    return { success: true, updateId }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to create owner update.",
    }
  }
}

export async function deleteOwnerProjectUpdateDraft(
  projectId: string,
  updateId: string
): Promise<
  | { readonly success: true }
  | { readonly success: false; readonly error: string }
> {
  try {
    const { db } = await verifyProjectMutationAccess(
      projectId,
      "owner-updates"
    )
    const [update] = await db
      .select({
        id: ownerProjectUpdates.id,
        status: ownerProjectUpdates.status,
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
    if (update.status !== "draft") {
      return {
        success: false,
        error: "Only draft owner updates can be deleted.",
      }
    }

    await db
      .delete(ownerProjectUpdates)
      .where(
        and(
          eq(ownerProjectUpdates.id, updateId),
          eq(ownerProjectUpdates.projectId, projectId),
          eq(ownerProjectUpdates.status, "draft")
        )
      )

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/owner-updates`)

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to delete owner update.",
    }
  }
}

export async function getOwnerProjectUpdateDocument(
  projectId: string,
  updateId: string
): Promise<OwnerProjectUpdateDocument> {
  const { db, viewer } = await verifyOwnerUpdateReadAccess(projectId)

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
      recalledAt: ownerProjectUpdates.recalledAt,
      updatedAt: ownerProjectUpdates.updatedAt,
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
  const composerSnapshot = parseOwnerUpdateComposerSnapshot(
    update.scheduleSnapshot
  )
  const canManage = can(viewer, "project", "update")

  const allLogRows = await db
    .select({
      id: dailyLogs.id,
      sourceSystem: dailyLogs.sourceSystem,
      logDate: dailyLogs.logDate,
      workCompleted: dailyLogs.workCompleted,
      weatherTempF: dailyLogs.weatherTempF,
      weatherConditions: dailyLogs.weatherConditions,
      crewPresent: dailyLogs.crewPresent,
      safetyIncidents: dailyLogs.safetyIncidents,
      issues: dailyLogs.issues,
      notes: dailyLogs.notes,
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
    .orderBy(asc(dailyLogs.logDate), asc(dailyLogs.createdAt))

  const allPhotoRows = await db
    .select({
      id: dailyLogPhotos.id,
      dailyLogId: dailyLogPhotos.dailyLogId,
      sourceSystem: dailyLogPhotos.sourceSystem,
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

  const attachmentScopeDailyLogIds = new Set(
    allLogRows
      .filter((row) =>
        isDateWithinOwnerUpdatePeriod(
          row.logDate,
          update.periodStart,
          update.periodEnd
        )
      )
      .map((row) => row.id)
  )
  const mapDailyLog = (
    row: (typeof allLogRows)[number]
  ): OwnerUpdateDailyLog => ({
      id: row.id,
      sourceSystem: row.sourceSystem,
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
      reviewStatus: row.reviewStatus,
      isClientVisible: row.isClientVisible,
    })
  const dailyLogsForUpdate = selectRowsByIdOrder(
    allLogRows,
    selectedDailyLogIds
  )
    .filter(
      (row) =>
        row.reviewStatus === "approved" &&
        row.isClientVisible &&
        isDateWithinOwnerUpdatePeriod(
          row.logDate,
          update.periodStart,
          update.periodEnd
        )
    )
    .map(mapDailyLog)
  const availableDailyLogs = canManage
    ? allLogRows
        .filter((row) =>
          isDateWithinOwnerUpdatePeriod(
            row.logDate,
            update.periodStart,
            update.periodEnd
          )
        )
        .slice(0, 100)
        .map(mapDailyLog)
    : []

  const imageRows = allPhotoRows.filter(
    (row) =>
      row.thumbnailUrl !== null || row.mimeType?.startsWith("image/") === true
  )
  const documentRows = allPhotoRows.filter(
    (row) =>
      row.thumbnailUrl === null && row.mimeType?.startsWith("image/") !== true
  )

  const selectedImageRows = selectRowsByIdOrder(imageRows, selectedPhotoIds)
  const photosForUpdate = selectedImageRows
    .filter(
      (row) =>
        update.status !== "published" ||
        (row.reviewStatus === "approved" && row.ownerVisible)
    )
    .map((row) => ({
      id: row.id,
      sourceSystem: row.sourceSystem,
      fileName: row.fileName,
      mimeType: row.mimeType,
      driveUrl: row.driveUrl,
      driveFileId: row.driveFileId,
      thumbnailUrl: row.thumbnailUrl,
      caption: row.caption,
      capturedAt: row.capturedAt,
      reviewStatus: row.reviewStatus,
      ownerVisible: row.ownerVisible,
    }))

  const selectablePhotoRows = retainSelectedAndScopedRows(
    imageRows,
    selectedPhotoIds,
    (row) =>
      update.periodStart !== null &&
      update.periodEnd !== null &&
      isPhotoInOwnerUpdateScope(
        row,
        attachmentScopeDailyLogIds,
        update.periodStart,
        update.periodEnd
      )
  )
  const availablePhotos = canManage
    ? selectablePhotoRows.map((row) => ({
          id: row.id,
          sourceSystem: row.sourceSystem,
          fileName: row.fileName,
          mimeType: row.mimeType,
          driveUrl: row.driveUrl,
          driveFileId: row.driveFileId,
          thumbnailUrl: row.thumbnailUrl,
          caption: row.caption,
          capturedAt: row.capturedAt,
          reviewStatus: row.reviewStatus,
          ownerVisible: row.ownerVisible,
        }))
    : []

  const selectedDocumentIds = composerSnapshot.documents.map(
    (document) => document.id
  )
  const selectedDocumentIdSet = new Set(selectedDocumentIds)
  const scopedDocumentRows = documentRows.filter(
    (row) =>
      !selectedDocumentIdSet.has(row.id) &&
      update.periodStart !== null &&
      update.periodEnd !== null &&
      isPhotoInOwnerUpdateScope(
        row,
        attachmentScopeDailyLogIds,
        update.periodStart,
        update.periodEnd
      )
  )
  const availableDocuments = canManage
    ? [
        ...composerSnapshot.documents,
        ...scopedDocumentRows.map(ownerUpdateDocumentSelection),
      ].slice(0, 120)
    : []
  const currentCandidates =
    canManage &&
    update.status !== "published" &&
    update.periodStart !== null &&
    update.periodEnd !== null
      ? await getOwnerUpdateComposerCandidates(
          db,
          projectId,
          update.periodStart,
          update.periodEnd
        )
      : {
          completedScheduleItems: [],
          lookAheadScheduleItems: [],
          todos: [],
        }
  function reconciledScheduleItems(
    selected: readonly OwnerUpdateScheduleSelection[],
    available: readonly OwnerUpdateScheduleSelection[]
  ): readonly OwnerUpdateScheduleSelection[] {
    const availableById = new Map(available.map((item) => [item.id, item]))
    return selected.map((item) => {
      const candidate =
        availableById.get(item.id) ??
        available.find(
          (availableItem) =>
            availableItem.title === item.title &&
            availableItem.startDate === item.startDate &&
            availableItem.endDate === item.endDate
        )
      return candidate === undefined
        ? item
        : { ...candidate, title: item.title, notes: item.notes }
    })
  }
  const completedScheduleItems = reconciledScheduleItems(
    composerSnapshot.completedScheduleItems,
    currentCandidates.completedScheduleItems
  )
  const lookAheadScheduleItems = reconciledScheduleItems(
    composerSnapshot.lookAheadScheduleItems,
    currentCandidates.lookAheadScheduleItems
  )

  return {
    canManage,
    viewerId: viewer.id,
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
      recalledAt: update.recalledAt,
      updatedAt: update.updatedAt,
      sourceDailyLogIds: selectedDailyLogIds,
      selectedPhotoIds,
      selectedDocumentIds,
      periodStart: update.periodStart,
      periodEnd: update.periodEnd,
    },
    dailyLogs: dailyLogsForUpdate,
    availableDailyLogs,
    photos: photosForUpdate,
    availablePhotos,
    documents: composerSnapshot.documents,
    availableDocuments,
    photoFolder:
      photoFolder
        ? {
            label: photoFolder.label,
          }
        : null,
    nextScheduleItem: lookAheadScheduleItems[0] ?? null,
    completedScheduleItems,
    lookAheadScheduleItems,
    availableCompletedScheduleItems:
      currentCandidates.completedScheduleItems,
    availableLookAheadScheduleItems:
      currentCandidates.lookAheadScheduleItems,
    todos: composerSnapshot.todos,
    availableTodos: currentCandidates.todos,
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
    const { db } = await verifyProjectMutationAccess(
      projectId,
      "owner-updates"
    )
    const title = input.title.trim()
    const updateDate = input.updateDate.trim()
    const periodStart = input.periodStart.trim()
    const periodEnd = input.periodEnd.trim()
    const summary = input.summary.trim()
    const sourceDailyLogIds = [...new Set(input.sourceDailyLogIds)]
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
    const selectedPhotoIds = [...new Set(input.selectedPhotoIds)]
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
    const selectedDocumentIds = [...new Set(input.selectedDocumentIds)]
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

    const [update] = await db
      .select({
        id: ownerProjectUpdates.id,
        status: ownerProjectUpdates.status,
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

    if (sourceDailyLogIds.length > 0) {
      const selectedLogs = (
        await Promise.all(
          ownerUpdateIdBatches(sourceDailyLogIds).map((idBatch) =>
            db
              .select({
                id: dailyLogs.id,
                logDate: dailyLogs.logDate,
              })
              .from(dailyLogs)
              .where(
                and(
                  eq(dailyLogs.projectId, projectId),
                  inArray(dailyLogs.id, idBatch)
                )
              )
          )
        )
      ).flat()

      if (selectedLogs.length !== sourceDailyLogIds.length) {
        return {
          success: false,
          error: "One or more source daily logs could not be found.",
        }
      }

      if (
        selectedLogs.some(
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

    const selectedAttachmentIds = [
      ...selectedPhotoIds,
      ...selectedDocumentIds,
    ]
    let documentSelections: readonly OwnerUpdateDocumentSelection[] = []
    if (selectedAttachmentIds.length > 0) {
      const selectedAttachments = (
        await Promise.all(
          ownerUpdateIdBatches(selectedAttachmentIds).map((idBatch) =>
            db
              .select({
                id: dailyLogPhotos.id,
                dailyLogId: dailyLogPhotos.dailyLogId,
                sourceSystem: dailyLogPhotos.sourceSystem,
                fileName: dailyLogPhotos.fileName,
                mimeType: dailyLogPhotos.mimeType,
                driveFileId: dailyLogPhotos.driveFileId,
                driveUrl: dailyLogPhotos.driveUrl,
                thumbnailUrl: dailyLogPhotos.thumbnailUrl,
                caption: dailyLogPhotos.caption,
                capturedAt: dailyLogPhotos.capturedAt,
              })
              .from(dailyLogPhotos)
              .where(
                and(
                  eq(dailyLogPhotos.projectId, projectId),
                  inArray(dailyLogPhotos.id, idBatch)
                )
              )
          )
        )
      ).flat()

      if (selectedAttachments.length !== selectedAttachmentIds.length) {
        return {
          success: false,
          error: "One or more selected files could not be found.",
        }
      }

      const attachmentScopeRows = await db
        .select({
          id: dailyLogs.id,
          logDate: dailyLogs.logDate,
        })
        .from(dailyLogs)
        .where(eq(dailyLogs.projectId, projectId))
      const sourceDailyLogIdSet = new Set(
        attachmentScopeRows
          .filter((log) =>
            isDateWithinOwnerUpdatePeriod(
              log.logDate,
              periodStart,
              periodEnd
            )
          )
          .map((log) => log.id)
      )
      if (
        selectedAttachments.some(
          (attachment) =>
            !isPhotoInOwnerUpdateScope(
              attachment,
              sourceDailyLogIdSet,
              periodStart,
              periodEnd
            )
        )
      ) {
        return {
          success: false,
          error:
            "Selected files must be tied to a source log or captured during the reporting period.",
        }
      }

      const selectedPhotoIdSet = new Set(selectedPhotoIds)
      if (
        selectedAttachments.some((attachment) => {
          const isImage =
            attachment.thumbnailUrl !== null ||
            attachment.mimeType?.startsWith("image/") === true
          return selectedPhotoIdSet.has(attachment.id) !== isImage
        })
      ) {
        return {
          success: false,
          error: "Photos and documents must be selected in the correct section.",
        }
      }

      const attachmentsById = new Map(
        selectedAttachments.map((attachment) => [
          attachment.id,
          attachment,
        ])
      )
      documentSelections = selectedDocumentIds.flatMap((id) => {
        const attachment = attachmentsById.get(id)
        return attachment === undefined
          ? []
          : [ownerUpdateDocumentSelection(attachment)]
      })
    }

    const candidates = await getOwnerUpdateComposerCandidates(
      db,
      projectId,
      periodStart,
      periodEnd
    )
    const completedById = new Map(
      candidates.completedScheduleItems.map((item) => [item.id, item])
    )
    const lookAheadById = new Map(
      candidates.lookAheadScheduleItems.map((item) => [item.id, item])
    )
    const todosById = new Map(
      candidates.todos.map((item) => [item.id, item])
    )

    const completedScheduleItems = reconcileSubmittedScheduleSelections(
      input.completedScheduleItems,
      [...completedById.values()]
    )
    const lookAheadScheduleItems = reconcileSubmittedScheduleSelections(
      input.lookAheadScheduleItems,
      [...lookAheadById.values()]
    )
    const seenTodoIds = new Set<string>()
    const todos = input.todos.flatMap((item) => {
      if (seenTodoIds.has(item.id)) return []
      seenTodoIds.add(item.id)
      const candidate = todosById.get(item.id)
      if (candidate === undefined) return []
      const editedTitle = item.title.trim()
      return [
        {
          ...candidate,
          title: editedTitle.length > 0 ? editedTitle : candidate.title,
          description: item.description.trim(),
          notes: item.notes.trim(),
        },
      ]
    })
    const composerSnapshot: OwnerUpdateComposerSnapshot = {
      version: 2,
      completedScheduleItems,
      lookAheadScheduleItems,
      todos,
      documents: documentSelections,
    }

    await db
      .update(ownerProjectUpdates)
      .set({
        title,
        updateDate,
        periodStart,
        periodEnd,
        summary,
        sourceDailyLogIds: JSON.stringify(sourceDailyLogIds),
        selectedPhotoIds: JSON.stringify(selectedPhotoIds),
        scheduleSnapshot:
          serializeOwnerUpdateComposerSnapshot(composerSnapshot),
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(ownerProjectUpdates.id, updateId),
          eq(ownerProjectUpdates.projectId, projectId)
        )
      )

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

export async function draftOwnerProjectUpdateWithJarvis(
  projectId: string,
  updateId: string
): Promise<
  | { readonly success: true; readonly summary: string }
  | { readonly success: false; readonly error: string }
> {
  try {
    const { db, user } = await verifyProjectMutationAccess(
      projectId,
      "owner-updates"
    )
    const [update] = await db
      .select({
        id: ownerProjectUpdates.id,
        title: ownerProjectUpdates.title,
        status: ownerProjectUpdates.status,
        periodStart: ownerProjectUpdates.periodStart,
        periodEnd: ownerProjectUpdates.periodEnd,
        sourceDailyLogIds: ownerProjectUpdates.sourceDailyLogIds,
        selectedPhotoIds: ownerProjectUpdates.selectedPhotoIds,
        scheduleSnapshot: ownerProjectUpdates.scheduleSnapshot,
        projectName: projects.name,
        projectNumber: projects.projectNumber,
      })
      .from(ownerProjectUpdates)
      .innerJoin(projects, eq(ownerProjectUpdates.projectId, projects.id))
      .where(
        and(
          eq(ownerProjectUpdates.id, updateId),
          eq(ownerProjectUpdates.projectId, projectId)
        )
      )
      .limit(1)

    if (!update || update.status === "published") {
      return {
        success: false,
        error: "Only an owner update draft can be drafted with Jarvis.",
      }
    }
    if (
      update.periodStart === null ||
      update.periodEnd === null ||
      !isValidOwnerUpdatePeriod(update.periodStart, update.periodEnd)
    ) {
      return {
        success: false,
        error: "Save a valid reporting period before asking Jarvis.",
      }
    }

    const sourceDailyLogIds = parseIdList(update.sourceDailyLogIds)
    const selectedLogs = (
      await Promise.all(
        ownerUpdateIdBatches(sourceDailyLogIds).map((idBatch) =>
          db
            .select({
              id: dailyLogs.id,
              logDate: dailyLogs.logDate,
              workCompleted: dailyLogs.workCompleted,
              issues: dailyLogs.issues,
              notes: dailyLogs.notes,
            })
            .from(dailyLogs)
            .where(
              and(
                eq(dailyLogs.projectId, projectId),
                inArray(dailyLogs.id, idBatch)
              )
            )
            .orderBy(asc(dailyLogs.logDate), asc(dailyLogs.createdAt))
        )
      )
    ).flat()
    const selectedLogById = new Map(
      selectedLogs.map((log) => [log.id, log])
    )
    const orderedLogs = sourceDailyLogIds.flatMap((id) => {
      const log = selectedLogById.get(id)
      return log === undefined ? [] : [log]
    })
    const composerSnapshot = parseOwnerUpdateComposerSnapshot(
      update.scheduleSnapshot
    )
    const selectedAttachmentIds = [
      ...parseIdList(update.selectedPhotoIds),
      ...composerSnapshot.documents.map((document) => document.id),
    ]
    const selectedAttachments = (
      await Promise.all(
        ownerUpdateIdBatches(selectedAttachmentIds).map((idBatch) =>
          db
            .select({
              id: dailyLogPhotos.id,
              fileName: dailyLogPhotos.fileName,
              mimeType: dailyLogPhotos.mimeType,
              thumbnailUrl: dailyLogPhotos.thumbnailUrl,
              caption: dailyLogPhotos.caption,
            })
            .from(dailyLogPhotos)
            .where(
              and(
                eq(dailyLogPhotos.projectId, projectId),
                inArray(dailyLogPhotos.id, idBatch)
              )
            )
        )
      )
    ).flat()
    const selectedAttachmentById = new Map(
      selectedAttachments.map((attachment) => [
        attachment.id,
        attachment,
      ])
    )
    const orderedAttachments = selectedAttachmentIds.flatMap((id) => {
      const attachment = selectedAttachmentById.get(id)
      if (attachment === undefined) return []
      const isImage =
        attachment.thumbnailUrl !== null ||
        attachment.mimeType?.startsWith("image/") === true
      const kind: "photo" | "document" = isImage ? "photo" : "document"
      return [
        {
          fileName: attachment.fileName,
          caption: attachment.caption,
          kind,
        },
      ]
    })
    const prompt = buildOwnerUpdateDraftPrompt({
      projectLabel: update.projectNumber ?? update.projectName,
      periodStart: update.periodStart,
      periodEnd: update.periodEnd,
      dailyLogs: orderedLogs,
      attachments: orderedAttachments,
      completedScheduleItems:
        composerSnapshot.completedScheduleItems,
      lookAheadScheduleItems:
        composerSnapshot.lookAheadScheduleItems,
      todos: composerSnapshot.todos,
    }).slice(0, 3_950)

    const { env } = await getCloudflareContext()
    const configuredBridgeEnabled = Reflect.get(
      env,
      "JARVIS_AGENT_BRIDGE_ENABLED"
    )
    const configuredBridgeSecret = Reflect.get(env, "JARVIS_BRIDGE_SECRET")
    if (
      !isJarvisAgentBridgeEnabled(
        typeof configuredBridgeEnabled === "string"
          ? configuredBridgeEnabled
          : undefined
      ) ||
      typeof configuredBridgeSecret !== "string" ||
      configuredBridgeSecret.length === 0
    ) {
      return {
        success: false,
        error: "Jarvis drafting is not configured in this deployment.",
      }
    }

    const result = await relayAgentRequest({
      db,
      organizationId: user.organizationId,
      user: {
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        role: user.role,
      },
      sessionId: `owner-update:${updateId}:${Date.now()}`,
      currentPage:
        `/dashboard/projects/${projectId}/owner-updates/${updateId}`,
      timezone: "America/Denver",
      messages: [{ role: "user", content: prompt }],
    })
    if (!result.success) {
      return { success: false, error: result.error }
    }

    const summary = cleanOwnerUpdateDraft(result.content)
    if (summary.length === 0) {
      return { success: false, error: "Jarvis returned an empty draft." }
    }

    await db
      .update(ownerProjectUpdates)
      .set({
        summary,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(ownerProjectUpdates.id, updateId),
          eq(ownerProjectUpdates.projectId, projectId),
          eq(ownerProjectUpdates.status, "draft")
        )
      )

    revalidatePath(`/dashboard/projects/${projectId}/owner-updates`)
    revalidatePath(
      `/dashboard/projects/${projectId}/owner-updates/${updateId}`
    )

    return { success: true, summary }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Jarvis could not draft this owner update.",
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
  await requireFeaturePermission(user, "owner-updates", "update")
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
      scheduleSnapshot: ownerProjectUpdates.scheduleSnapshot,
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
  const composerSnapshot = parseOwnerUpdateComposerSnapshot(
    update.scheduleSnapshot
  )
  const selectedDocumentIds = composerSnapshot.documents.map(
    (document) => document.id
  )
  const selectedLogs = (
    await Promise.all(
      ownerUpdateIdBatches(sourceDailyLogIds).map((idBatch) =>
        db
          .select({
            id: dailyLogs.id,
            logDate: dailyLogs.logDate,
          })
          .from(dailyLogs)
          .where(
            and(
              eq(dailyLogs.projectId, projectId),
              inArray(dailyLogs.id, idBatch)
            )
          )
      )
    )
  ).flat()

  if (selectedLogs.length !== sourceDailyLogIds.length) {
    return {
      success: false,
      error: "One or more source daily logs could not be found.",
    }
  }

  const derivedPeriod = dateRangeFromDates(
    selectedLogs.map((log) => log.logDate)
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
    selectedLogs.some(
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

  const selectedAttachmentIds = [
    ...selectedPhotoIds,
    ...selectedDocumentIds,
  ]
  if (selectedAttachmentIds.length > 0) {
    const selectedAttachments = (
      await Promise.all(
        ownerUpdateIdBatches(selectedAttachmentIds).map((idBatch) =>
          db
            .select({
              id: dailyLogPhotos.id,
              dailyLogId: dailyLogPhotos.dailyLogId,
              capturedAt: dailyLogPhotos.capturedAt,
            })
            .from(dailyLogPhotos)
            .where(
              and(
                eq(dailyLogPhotos.projectId, projectId),
                inArray(dailyLogPhotos.id, idBatch)
              )
            )
        )
      )
    ).flat()

    if (selectedAttachments.length !== selectedAttachmentIds.length) {
      return {
        success: false,
        error:
          "Every selected photo and document must still belong to this project before publishing.",
      }
    }

    const attachmentScopeRows = await db
      .select({
        id: dailyLogs.id,
        logDate: dailyLogs.logDate,
      })
      .from(dailyLogs)
      .where(eq(dailyLogs.projectId, projectId))
    const sourceDailyLogIdSet = new Set(
      attachmentScopeRows
        .filter((log) =>
          isDateWithinOwnerUpdatePeriod(
            log.logDate,
            periodStart,
            periodEnd
          )
        )
        .map((log) => log.id)
    )
    if (
      selectedAttachments.some(
        (attachment) =>
          !isPhotoInOwnerUpdateScope(
            attachment,
            sourceDailyLogIdSet,
            periodStart,
            periodEnd
          )
      )
    ) {
      return {
        success: false,
        error:
          "Selected files must be tied to a source log or captured during the reporting period.",
      }
    }

    for (const idBatch of ownerUpdateIdBatches(selectedAttachmentIds)) {
      await db
        .update(dailyLogPhotos)
        .set({
          reviewStatus: "approved",
          ownerVisible: true,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(dailyLogPhotos.projectId, projectId),
            inArray(dailyLogPhotos.id, idBatch)
          )
        )
    }
  }

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
        serializeOwnerUpdateComposerSnapshot(composerSnapshot),
      publishedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(ownerProjectUpdates.id, updateId),
        eq(ownerProjectUpdates.projectId, projectId)
      )
    )

  revalidatePath(`/dashboard/projects/${projectId}`)
  revalidatePath(
    `/dashboard/projects/${projectId}/owner-updates/${updateId}`
  )

  return { success: true }
}

export async function recallOwnerProjectUpdate(
  projectId: string,
  updateId: string
): Promise<
  | { readonly success: true }
  | { readonly success: false; readonly error: string }
> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    await requireFeaturePermission(user, "owner-updates", "update")
    const orgId = requireOrg(user)
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const [update] = await db
      .select({ status: ownerProjectUpdates.status })
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
      return { success: false, error: "Owner update not found." }
    }
    if (update.status === "draft") {
      return { success: true }
    }
    if (update.status !== "published") {
      return {
        success: false,
        error: "Only a published owner update can be recalled.",
      }
    }

    const now = new Date().toISOString()
    await db
      .update(ownerProjectUpdates)
      .set({
        status: "draft",
        publishedAt: null,
        recalledAt: now,
        recalledBy: user.id,
        updatedAt: now,
      })
      .where(
        and(
          eq(ownerProjectUpdates.id, updateId),
          eq(ownerProjectUpdates.projectId, projectId),
          eq(ownerProjectUpdates.status, "published")
        )
      )

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/owner-updates`)
    revalidatePath(
      `/dashboard/projects/${projectId}/owner-updates/${updateId}`
    )
    revalidatePath(`/dashboard/projects/${projectId}/preview/owner`)

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to recall this owner update.",
    }
  }
}
