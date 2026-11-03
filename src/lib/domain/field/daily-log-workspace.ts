/**
 * The project daily log workspace: logs with their photos, schedule items,
 * to-dos and cost code lines, plus the form setup for new logs.
 */
import { and, asc, desc, eq, inArray, not, sql } from "drizzle-orm"

import {
  dailyLogPhotos,
  dailyLogs,
  dailyLogTaskLinks,
  ownerProjectUpdates,
  projectOperations,
  projects,
  scheduleTasks,
  users,
} from "@/db/schema"
import type { AuthUser } from "@/lib/auth"
import {
  dailyLogFormSetup,
  EMPTY_DAILY_LOG_FORM_SETUP,
  loadDailyLogWorkLines,
  type DailyLogFormSetup,
  type DailyLogWorkLineView,
} from "@/lib/daily-logs/cost-code-lines"
import { dailyLogDeleteBlocker } from "@/lib/daily-logs/delete-rules"
import { dailyLogAuthorName } from "@/lib/daily-logs/imported-author"
import { dailyLogFollowUpSetup, type DailyLogFollowUpSetup } from "@/lib/daily-logs/log-followups-server"
import { normalizeDailyLogNotes } from "@/lib/daily-logs/notes"
import { canFeature } from "@/lib/permission-enforcement"
import { dailyLogPhotoCollectionEligibility } from "@/lib/photos/collection-eligibility"
import type { Db } from "@/lib/server/action-context"
import { isInternalStaffRole } from "@/lib/user-roles"

import { personDisplayName, uniqueSchedulePhases, weatherLabel } from "./rules"

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

type ProjectDailyLogScheduleItem = {
  readonly id: string
  readonly title: string
  readonly startDate: string
  readonly endDate: string
  readonly status: string
  readonly notes: string | null
}

type ProjectDailyLogTodo = {
  readonly id: string
  readonly title: string
  /** Notes, which name the log line the to-do was made from. */
  readonly description: string | null
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
  /** Cost codes worked on, with time, in the order entered. */
  readonly workLines: readonly DailyLogWorkLineView[]
}

export type ProjectDailyLogWorkspace = {
  readonly project: {
    readonly id: string
    readonly name: string
    readonly projectNumber: string | null
    readonly clientName: string | null
  }
  readonly logs: readonly ProjectDailyLogItem[]
  /** The cost codes and required fields for new and edited logs. */
  readonly form: DailyLogFormSetup
  /** Open to-dos, client contacts and the company's rules for new logs; null for viewers who can't write logs. */
  readonly followUps: DailyLogFollowUpSetup | null
  /** Logs this viewer may delete (see lib/daily-logs/delete-rules). */
  readonly deletableLogIds: readonly string[]
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

/** Rows grouped under their daily log, in the order given. */
function groupByLog<T>(
  rows: readonly { readonly dailyLogId: string; readonly item: T }[]
): Map<string, T[]> {
  const byLog = new Map<string, T[]>()
  for (const row of rows) {
    const items = byLog.get(row.dailyLogId)
    if (items) items.push(row.item)
    else byLog.set(row.dailyLogId, [row.item])
  }
  return byLog
}

function groupPhotosByLog(
  rows: readonly (ProjectDailyLogPhoto & { readonly dailyLogId: string | null })[]
): {
  readonly photosByLogId: Map<string, ProjectDailyLogPhoto[]>
  readonly unattachedPhotos: ProjectDailyLogPhoto[]
} {
  const unattachedPhotos: ProjectDailyLogPhoto[] = []
  const attached: { readonly dailyLogId: string; readonly item: ProjectDailyLogPhoto }[] = []
  for (const row of rows) {
    const photo: ProjectDailyLogPhoto = {
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
    if (row.dailyLogId === null) unattachedPhotos.push(photo)
    else attached.push({ dailyLogId: row.dailyLogId, item: photo })
  }
  return { photosByLogId: groupByLog(attached), unattachedPhotos }
}

export async function loadProjectDailyLogWorkspace(
  db: Db,
  viewer: AuthUser,
  projectId: string
): Promise<ProjectDailyLogWorkspace> {
  const canViewWorkingSchedule = isInternalStaffRole(viewer.role)

  const [projectRow] = await db
    .select({
      id: projects.id,
      name: projects.name,
      projectNumber: projects.projectNumber,
      clientName: projects.clientName,
      organizationId: projects.organizationId,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  if (!projectRow) {
    throw new Error("Project not found")
  }
  const { organizationId, ...project } = projectRow

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
      tags: dailyLogs.tags,
      authorId: dailyLogs.authorId,
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
    .where(
      and(
        eq(dailyLogPhotos.projectId, projectId),
        dailyLogPhotoCollectionEligibility(),
        not(sql<boolean>`EXISTS (
          SELECT 1
          FROM daily_log_photo_aliases AS alias
          JOIN daily_log_photos AS canonical
            ON canonical.id IS alias.canonical_photo_id
          WHERE alias.source_photo_id IS ${dailyLogPhotos.id}
            AND alias.project_id IS ${dailyLogPhotos.projectId}
            AND canonical.project_id IS ${dailyLogPhotos.projectId}
            AND canonical.mime_type LIKE 'image/%'
            AND canonical.drive_file_id IS NOT NULL
            AND (
              canonical.drive_file_id IS NOT NULL
              OR canonical.thumbnail_url IS NOT NULL
            )
            AND ${dailyLogPhotos.dailyLogId} IS canonical.daily_log_id
        )`),
      ),
    )
    .orderBy(asc(dailyLogPhotos.sortOrder), desc(dailyLogPhotos.createdAt))

  const phaseRows = canViewWorkingSchedule ? await db
    .select({ phase: scheduleTasks.phase })
    .from(scheduleTasks)
    .where(eq(scheduleTasks.projectId, projectId))
    .orderBy(asc(scheduleTasks.sortOrder), asc(scheduleTasks.startDate))
    : []

  const schedulePhases = uniqueSchedulePhases(phaseRows.map((row) => row.phase))

  const logIds = logRows.map((row) => row.id)
  const taskRows =
    logIds.length === 0 || !canViewWorkingSchedule
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
            description: projectOperations.description,
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

  const { photosByLogId, unattachedPhotos } = groupPhotosByLog(photoRows)
  const scheduleItemsByLogId = groupByLog(
    taskRows.map((row) => ({
      dailyLogId: row.dailyLogId,
      item: {
        id: row.id,
        title: row.title,
        startDate: row.startDate,
        endDate: row.endDate,
        status: row.status,
        notes: row.notes,
      },
    }))
  )
  const todosByLogId = groupByLog(
    todoRows.flatMap((row) =>
      row.sourceRecordId
        ? [
            {
              dailyLogId: row.sourceRecordId,
              item: {
                id: row.id,
                title: row.title,
                description: row.description,
                status: row.status,
                priority: row.priority,
                assigneeName: row.assigneeName,
                companyName: row.companyName,
                dueDate: row.dueDate,
              },
            },
          ]
        : []
    )
  )

  let deletableLogIds: readonly string[] = []
  if (viewer.isActive && isInternalStaffRole(viewer.role) && logRows.length > 0) {
    const [canDeleteAny, canUpdate, ownerUpdates] = await Promise.all([
      canFeature(viewer, "daily-logs", "delete"),
      canFeature(viewer, "daily-logs", "update"),
      db
        .select({ title: ownerProjectUpdates.title, sourceDailyLogIds: ownerProjectUpdates.sourceDailyLogIds })
        .from(ownerProjectUpdates)
        .where(eq(ownerProjectUpdates.projectId, projectId)),
    ])
    deletableLogIds = logRows
      .filter((row) => dailyLogDeleteBlocker(row, { viewerId: viewer.id, canDeleteAny, canUpdate, ownerUpdates }) === null)
      .map((row) => row.id)
  }

  const canWriteLogs = organizationId !== null && viewer.isActive && isInternalStaffRole(viewer.role)
  const [workLinesByLogId, form, followUps] = await Promise.all([
    loadDailyLogWorkLines(db, logRows.map((row) => row.id)),
    organizationId ? dailyLogFormSetup(db, organizationId, projectId) : Promise.resolve(EMPTY_DAILY_LOG_FORM_SETUP),
    canWriteLogs && organizationId ? dailyLogFollowUpSetup(db, organizationId, projectId) : Promise.resolve(null),
  ])

  return {
    project,
    form,
    followUps,
    deletableLogIds,
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
      authorName: dailyLogAuthorName({
        compassAuthorName: personDisplayName({
          displayName: row.authorDisplayName,
          firstName: row.authorFirstName,
          lastName: row.authorLastName,
          email: row.authorEmail,
        }),
        tags: row.tags,
      }),
      photos: photosByLogId.get(row.id) ?? [],
      scheduleItems: scheduleItemsByLogId.get(row.id) ?? [],
      todos: todosByLogId.get(row.id) ?? [],
      workLines: workLinesByLogId.get(row.id) ?? [],
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
