"use server"

import { and, asc, desc, eq, gte, inArray } from "drizzle-orm"

import { getDb } from "@/db"
import {
  dailyLogPhotos,
  dailyLogs,
  dailyLogTaskLinks,
  ownerProjectUpdates,
  projectExternalLinks,
  scheduleTasks,
  projects,
  users,
} from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { requireOrg } from "@/lib/org-scope"
import { requirePermission } from "@/lib/permissions"
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
  readonly driveUrl: string | null
  readonly thumbnailUrl: string | null
  readonly caption: string | null
  readonly capturedAt: string | null
}

type OwnerUpdatePhotoFolder = {
  readonly label: string
  readonly url: string
}

type PhotoReviewFolder = {
  readonly label: string
  readonly url: string
  readonly photoCount: number | null
}

export type ProjectDailyLogPhoto = {
  readonly id: string
  readonly fileName: string
  readonly driveUrl: string | null
  readonly thumbnailUrl: string | null
  readonly caption: string | null
  readonly capturedAt: string | null
  readonly reviewStatus: string
  readonly ownerVisible: boolean
  readonly subVendorVisible: boolean
  readonly publicShareable: boolean
}

export type ProjectDailyLogTask = {
  readonly id: string
  readonly title: string
  readonly startDate: string
  readonly endDate: string
  readonly status: string
  readonly notes: string | null
}

export type ProjectDailyLogItem = {
  readonly id: string
  readonly sourceSystem: string
  readonly sourceExternalId: string | null
  readonly logDate: string
  readonly weather: string | null
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
  readonly tasks: readonly ProjectDailyLogTask[]
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

type OwnerUpdateDraftInput = {
  readonly dailyLogIds: readonly string[]
}

type DailyLogMutationResult =
  | { readonly success: true }
  | { readonly success: false; readonly error: string }

type OwnerUpdateDraftResult =
  | { readonly success: true; readonly updateId: string }
  | { readonly success: false; readonly error: string }

export type OwnerProjectUpdateDocument = {
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
  }
  readonly dailyLogs: readonly OwnerUpdateDailyLog[]
  readonly photos: readonly OwnerUpdatePhoto[]
  readonly photoFolder: OwnerUpdatePhotoFolder | null
  readonly nextScheduleItem: {
    readonly title: string
    readonly startDate: string
    readonly endDate: string
    readonly assignedTo: string | null
  } | null
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
    return parsed.filter((item): item is string => typeof item === "string")
  } catch {
    return []
  }
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
  const latestUpdate = updateRows[0]
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
    ownerUpdateCount: updateRows.length,
    draftOwnerUpdateCount: updateRows.filter(
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

  const photosByLogId = new Map<string, ProjectDailyLogPhoto[]>()
  const unattachedPhotos: ProjectDailyLogPhoto[] = []

  for (const row of photoRows) {
    const photo = {
      id: row.id,
      fileName: row.fileName,
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

  const tasksByLogId = new Map<string, ProjectDailyLogTask[]>()
  for (const row of taskRows) {
    tasksByLogId.set(row.dailyLogId, [
      ...(tasksByLogId.get(row.dailyLogId) ?? []),
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
      workCompleted: row.workCompleted,
      issues: row.issues,
      materialsUsed: row.materialsUsed,
      crewPresent: row.crewPresent,
      hoursWorked: row.hoursWorked,
      safetyIncidents: row.safetyIncidents,
      visitorLog: row.visitorLog,
      notes: row.notes,
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
      tasks: tasksByLogId.get(row.id) ?? [],
    })),
    unattachedPhotos,
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
          inArray(dailyLogs.id, dailyLogIds)
        )
      )
      .orderBy(asc(dailyLogs.logDate), asc(dailyLogs.createdAt))

    if (selectedLogs.length === 0) {
      return { success: false, error: "Selected daily logs were not found." }
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
  const db = await verifyProjectAccess(projectId)
  const today = new Date().toISOString().slice(0, 10)

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
    .where(eq(dailyLogs.projectId, projectId))
    .orderBy(asc(dailyLogs.logDate), asc(dailyLogs.createdAt))

  const allPhotoRows = await db
    .select({
      id: dailyLogPhotos.id,
      fileName: dailyLogPhotos.fileName,
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
      url: projectExternalLinks.externalUrl,
    })
    .from(projectExternalLinks)
    .where(
      and(
        eq(projectExternalLinks.projectId, projectId),
        eq(projectExternalLinks.system, "google_progress_photos_folder")
      )
    )
    .limit(1)

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

  const dailyLogIds = new Set(selectedDailyLogIds)
  const photoIds = new Set(selectedPhotoIds)
  const dailyLogsForUpdate = allLogRows
    .filter((row) => dailyLogIds.size === 0 || dailyLogIds.has(row.id))
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
      nextSteps: row.notes,
      authorName: displayName({
        displayName: row.authorDisplayName,
        firstName: row.authorFirstName,
        lastName: row.authorLastName,
        email: row.authorEmail,
      }),
    }))

  const photosForUpdate = allPhotoRows
    .filter((row) => {
      const isImage =
        row.thumbnailUrl !== null || row.mimeType?.startsWith("image/") === true
      if (!isImage) return false
      if (photoIds.size > 0 && photoIds.has(row.id)) return true
      return row.ownerVisible && row.reviewStatus === "approved"
    })
    .slice(0, 18)
    .map((row) => ({
      id: row.id,
      fileName: row.fileName,
      driveUrl: row.driveUrl,
      thumbnailUrl: row.thumbnailUrl,
      caption: row.caption,
      capturedAt: row.capturedAt,
    }))

  return {
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
    },
    dailyLogs: dailyLogsForUpdate,
    photos: photosForUpdate,
    photoFolder:
      photoFolder?.url
        ? {
            label: photoFolder.label,
            url: photoFolder.url,
          }
        : null,
    nextScheduleItem: nextTask ?? null,
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

  const now = new Date().toISOString()

  await db
    .update(ownerProjectUpdates)
    .set({
      status: "published",
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
