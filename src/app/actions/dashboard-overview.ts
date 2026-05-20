"use server"

import { asc, desc, eq } from "drizzle-orm"

import { getDb } from "@/db"
import {
  dailyLogPhotos,
  dailyLogs,
  ownerProjectUpdates,
  projectOperations,
  projectRfis,
  projects,
  scheduleTasks,
} from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { requireOrg } from "@/lib/org-scope"
import { canManageProjectRegistry } from "@/lib/permissions"
import {
  allowedWorkflowRoleIds,
  defaultWorkflowRoleId,
  type ProjectWorkflowRoleId,
} from "@/lib/project-workflow-roles"
import { getSageBridgeStatus } from "@/lib/sage/config"

type DashboardTask = {
  readonly id: string
  readonly projectId: string
  readonly projectLabel: string
  readonly title: string
  readonly startDate: string
  readonly endDate: string
  readonly assignedTo: string | null
  readonly status: string
}

type DashboardProject = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
  readonly clientName: string | null
  readonly status: string
  readonly sageJobId: string | null
  readonly sageJobNumber: string | null
  readonly googleDriveFolderId: string | null
  readonly progress: number
  readonly activeTaskCount: number
  readonly nextTask: DashboardTask | null
  readonly photosToReview: number
  readonly ownerVisiblePhotos: number
  readonly latestLog: {
    readonly logDate: string
    readonly sourceSystem: string
    readonly reviewStatus: string
  } | null
  readonly latestOwnerUpdate: {
    readonly id: string
    readonly title: string
    readonly status: string
    readonly updateDate: string
  } | null
  readonly openPoCount: number
  readonly openPoAmount: number
  readonly activeCommitmentCount: number
  readonly openRfiCount: number
}

type DashboardRfi = {
  readonly id: string
  readonly projectId: string
  readonly projectLabel: string
  readonly rfiNumber: string
  readonly subject: string
  readonly priority: string
  readonly status: string
  readonly dueDate: string | null
}

type DashboardOperation = {
  readonly id: string
  readonly projectId: string
  readonly projectLabel: string
  readonly type: string
  readonly number: string | null
  readonly title: string
  readonly dueDate: string | null
  readonly amount: number | null
  readonly assigneeName: string | null
  readonly companyName: string | null
}

type DashboardFieldPhoto = {
  readonly id: string
  readonly projectId: string
  readonly projectLabel: string
  readonly projectName: string
  readonly fileName: string
  readonly imageUrl: string
  readonly driveUrl: string | null
  readonly caption: string | null
  readonly capturedAt: string | null
  readonly photoKind: string
}

export type DashboardOverview = {
  readonly today: string
  readonly user: {
    readonly role: string | null
    readonly canUseDeveloperMode: boolean
    readonly defaultWorkflowRoleId: ProjectWorkflowRoleId
    readonly allowedWorkflowRoleIds: readonly ProjectWorkflowRoleId[]
  }
  readonly metrics: {
    readonly activeProjects: number
    readonly upcomingTasks: number
    readonly photosToReview: number
    readonly openRfis: number
    readonly openPoAmount: number
    readonly draftOwnerUpdates: number
  }
  readonly sageBridge: {
    readonly configured: boolean
    readonly readOnly: boolean
    readonly mode: "sql-server"
    readonly mappedProjectCount: number
    readonly mappedOperationCount: number
    readonly lastSyncedAt: string | null
    readonly missingConfigKeys: readonly string[]
    readonly message: string
  }
  readonly projects: readonly DashboardProject[]
  readonly upcomingTasks: readonly DashboardTask[]
  readonly openRfis: readonly DashboardRfi[]
  readonly operations: readonly DashboardOperation[]
  readonly fieldPhotos: readonly DashboardFieldPhoto[]
}

function emptyOverview(): DashboardOverview {
  const today = new Date().toISOString().slice(0, 10)

  return {
    today,
    user: {
      role: null,
      canUseDeveloperMode: false,
      defaultWorkflowRoleId: "project-manager",
      allowedWorkflowRoleIds: [],
    },
    metrics: {
      activeProjects: 0,
      upcomingTasks: 0,
      photosToReview: 0,
      openRfis: 0,
      openPoAmount: 0,
      draftOwnerUpdates: 0,
    },
    sageBridge: {
      configured: false,
      readOnly: true,
      mode: "sql-server",
      mappedProjectCount: 0,
      mappedOperationCount: 0,
      lastSyncedAt: null,
      missingConfigKeys: [],
      message: "Sage bridge status is unavailable.",
    },
    projects: [],
    upcomingTasks: [],
    openRfis: [],
    operations: [],
    fieldPhotos: [],
  }
}

function isClosedStatus(status: string): boolean {
  const normalized = status.toLowerCase()
  return (
    normalized === "complete" ||
    normalized === "completed" ||
    normalized === "done" ||
    normalized === "closed" ||
    normalized === "cancelled" ||
    normalized === "canceled"
  )
}

function projectLabel(project: {
  readonly projectNumber: string | null
  readonly name: string
}): string {
  return project.projectNumber ?? project.name
}

function averageProgress(
  rows: readonly { readonly percentComplete: number }[]
): number {
  if (rows.length === 0) return 0
  const total = rows.reduce((sum, row) => sum + row.percentComplete, 0)
  return Math.round(total / rows.length)
}

export async function getDashboardOverview(): Promise<DashboardOverview> {
  try {
    const user = await requireAuth()
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    if (!env?.DB) return emptyOverview()
    const sageBridgeConfig = getSageBridgeStatus(
      env as unknown as Record<string, string | undefined>
    )

    const db = getDb(env.DB)
    const today = new Date().toISOString().slice(0, 10)

    const projectRows = await db
      .select({
        id: projects.id,
        name: projects.name,
        projectNumber: projects.projectNumber,
        clientName: projects.clientName,
        status: projects.status,
        sageJobId: projects.sageJobId,
        sageJobNumber: projects.sageJobNumber,
        googleDriveFolderId: projects.googleDriveFolderId,
      })
      .from(projects)
      .where(eq(projects.organizationId, orgId))
      .orderBy(asc(projects.projectNumber), asc(projects.name))

    const dashboardProjects: DashboardProject[] = []
    const upcomingTasks: DashboardTask[] = []
    const openRfis: DashboardRfi[] = []
    const operations: DashboardOperation[] = []
    const fieldPhotos: DashboardFieldPhoto[] = []
    let mappedProjectCount = 0
    let mappedOperationCount = 0
    let lastSageSyncedAt: string | null = null
    let photosToReview = 0
    let openPoAmount = 0
    let draftOwnerUpdates = 0

    for (const project of projectRows) {
      const label = projectLabel(project)
      if (project.sageJobId || project.sageJobNumber) {
        mappedProjectCount += 1
      }

      const taskRows = await db
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
        .where(eq(scheduleTasks.projectId, project.id))
        .orderBy(asc(scheduleTasks.startDate), asc(scheduleTasks.sortOrder))

      const activeTasks = taskRows.filter((task) => !isClosedStatus(task.status))
      const nextTaskRow =
        activeTasks.find((task) => task.startDate >= today) ?? activeTasks[0]
      const nextTask = nextTaskRow
        ? {
            id: nextTaskRow.id,
            projectId: project.id,
            projectLabel: label,
            title: nextTaskRow.title,
            startDate: nextTaskRow.startDate,
            endDate: nextTaskRow.endDate,
            assignedTo: nextTaskRow.assignedTo,
            status: nextTaskRow.status,
          }
        : null

      if (nextTask) upcomingTasks.push(nextTask)

      const photoRows = await db
        .select({
          id: dailyLogPhotos.id,
          fileName: dailyLogPhotos.fileName,
          driveUrl: dailyLogPhotos.driveUrl,
          thumbnailUrl: dailyLogPhotos.thumbnailUrl,
          caption: dailyLogPhotos.caption,
          capturedAt: dailyLogPhotos.capturedAt,
          mimeType: dailyLogPhotos.mimeType,
          photoKind: dailyLogPhotos.photoKind,
          createdAt: dailyLogPhotos.createdAt,
          reviewStatus: dailyLogPhotos.reviewStatus,
          ownerVisible: dailyLogPhotos.ownerVisible,
        })
        .from(dailyLogPhotos)
        .where(eq(dailyLogPhotos.projectId, project.id))
        .orderBy(desc(dailyLogPhotos.capturedAt), desc(dailyLogPhotos.createdAt))

      const projectPhotosToReview = photoRows.filter(
        (photo) => photo.reviewStatus === "needs_review"
      ).length
      const ownerVisiblePhotos = photoRows.filter(
        (photo) => photo.ownerVisible
      ).length
      photosToReview += projectPhotosToReview

      const progressPhotoRows = photoRows.filter((photo) => {
        const hasImage =
          photo.thumbnailUrl !== null ||
          (photo.driveUrl !== null && photo.mimeType?.startsWith("image/") === true)
        return (
          hasImage &&
          photo.reviewStatus === "approved" &&
          photo.photoKind === "progress"
        )
      })

      for (const photo of progressPhotoRows.slice(0, 5)) {
        const imageUrl = photo.thumbnailUrl ?? photo.driveUrl
        if (imageUrl === null) continue

        fieldPhotos.push({
          id: photo.id,
          projectId: project.id,
          projectLabel: label,
          projectName: project.name,
          fileName: photo.fileName,
          imageUrl,
          driveUrl: photo.driveUrl,
          caption: photo.caption,
          capturedAt: photo.capturedAt ?? photo.createdAt,
          photoKind: photo.photoKind,
        })
      }

      const latestLogRows = await db
        .select({
          logDate: dailyLogs.logDate,
          sourceSystem: dailyLogs.sourceSystem,
          reviewStatus: dailyLogs.reviewStatus,
        })
        .from(dailyLogs)
        .where(eq(dailyLogs.projectId, project.id))
        .orderBy(desc(dailyLogs.logDate))
        .limit(1)

      const latestOwnerUpdateRows = await db
        .select({
          id: ownerProjectUpdates.id,
          title: ownerProjectUpdates.title,
          status: ownerProjectUpdates.status,
          updateDate: ownerProjectUpdates.updateDate,
        })
        .from(ownerProjectUpdates)
        .where(eq(ownerProjectUpdates.projectId, project.id))
        .orderBy(desc(ownerProjectUpdates.updateDate))
        .limit(1)

      const ownerUpdateRows = await db
        .select({ status: ownerProjectUpdates.status })
        .from(ownerProjectUpdates)
        .where(eq(ownerProjectUpdates.projectId, project.id))
      const projectDraftOwnerUpdates = ownerUpdateRows.filter(
        (update) => update.status === "draft"
      ).length
      draftOwnerUpdates += projectDraftOwnerUpdates

      const operationRows = await db
        .select({
          id: projectOperations.id,
          sourceRecordType: projectOperations.sourceRecordType,
          sourceRecordNumber: projectOperations.sourceRecordNumber,
          title: projectOperations.title,
          status: projectOperations.status,
          dueDate: projectOperations.dueDate,
          amount: projectOperations.amount,
          sourceSystem: projectOperations.sourceSystem,
          lastSyncedAt: projectOperations.lastSyncedAt,
          assigneeName: projectOperations.assigneeName,
          companyName: projectOperations.companyName,
        })
        .from(projectOperations)
        .where(eq(projectOperations.projectId, project.id))
        .orderBy(asc(projectOperations.dueDate), asc(projectOperations.title))

      const activeOperations = operationRows.filter(
        (operation) => !isClosedStatus(operation.status)
      )
      const sageOperations = operationRows.filter(
        (operation) => operation.sourceSystem === "sage"
      )
      mappedOperationCount += sageOperations.length
      for (const operation of sageOperations) {
        if (
          operation.lastSyncedAt &&
          (!lastSageSyncedAt || operation.lastSyncedAt > lastSageSyncedAt)
        ) {
          lastSageSyncedAt = operation.lastSyncedAt
        }
      }
      const openPoRows = activeOperations.filter(
        (operation) => operation.sourceRecordType === "purchase_order"
      )
      const projectOpenPoAmount = openPoRows.reduce(
        (sum, operation) => sum + (operation.amount ?? 0),
        0
      )
      openPoAmount += projectOpenPoAmount

      for (const operation of activeOperations.slice(0, 4)) {
        operations.push({
          id: operation.id,
          projectId: project.id,
          projectLabel: label,
          type: operation.sourceRecordType,
          number: operation.sourceRecordNumber,
          title: operation.title,
          dueDate: operation.dueDate,
          amount: operation.amount,
          assigneeName: operation.assigneeName,
          companyName: operation.companyName,
        })
      }

      const rfiRows = await db
        .select({
          id: projectRfis.id,
          rfiNumber: projectRfis.rfiNumber,
          subject: projectRfis.subject,
          priority: projectRfis.priority,
          status: projectRfis.status,
          dueDate: projectRfis.dueDate,
        })
        .from(projectRfis)
        .where(eq(projectRfis.projectId, project.id))
        .orderBy(asc(projectRfis.dueDate), asc(projectRfis.rfiNumber))

      const projectOpenRfis = rfiRows.filter(
        (rfi) => !isClosedStatus(rfi.status) && rfi.status !== "answered"
      )
      for (const rfi of projectOpenRfis) {
        openRfis.push({
          id: rfi.id,
          projectId: project.id,
          projectLabel: label,
          rfiNumber: rfi.rfiNumber,
          subject: rfi.subject,
          priority: rfi.priority,
          status: rfi.status,
          dueDate: rfi.dueDate,
        })
      }

      dashboardProjects.push({
        id: project.id,
        name: project.name,
        projectNumber: project.projectNumber,
        clientName: project.clientName,
        status: project.status,
        sageJobId: project.sageJobId,
        sageJobNumber: project.sageJobNumber,
        googleDriveFolderId: project.googleDriveFolderId,
        progress: averageProgress(taskRows),
        activeTaskCount: activeTasks.length,
        nextTask,
        photosToReview: projectPhotosToReview,
        ownerVisiblePhotos,
        latestLog: latestLogRows[0] ?? null,
        latestOwnerUpdate: latestOwnerUpdateRows[0] ?? null,
        openPoCount: openPoRows.length,
        openPoAmount: projectOpenPoAmount,
        activeCommitmentCount: activeOperations.length,
        openRfiCount: projectOpenRfis.length,
      })
    }

    const sortedUpcomingTasks = upcomingTasks
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
      .slice(0, 8)
    const sortedOperations = operations
      .sort((a, b) => (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31"))
      .slice(0, 8)
    const sortedRfis = openRfis
      .sort((a, b) => (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31"))
      .slice(0, 8)
    const sortedFieldPhotos = fieldPhotos
      .sort((a, b) =>
        (b.capturedAt ?? "").localeCompare(a.capturedAt ?? "")
      )
      .slice(0, 10)

    const canUseDeveloperMode = canManageProjectRegistry(user)
    const allowedRoleIds = allowedWorkflowRoleIds({
      projectRole: null,
      userRole: user.role,
      canUseDeveloperMode,
    })
    const defaultRoleId = defaultWorkflowRoleId({
      projectRole: null,
      userRole: user.role,
      canUseDeveloperMode,
    })
    const safeDefaultRoleId = allowedRoleIds.includes(defaultRoleId)
      ? defaultRoleId
      : (allowedRoleIds[0] ?? "project-manager")

    return {
      today,
      user: {
        role: user.role,
        canUseDeveloperMode,
        defaultWorkflowRoleId: safeDefaultRoleId,
        allowedWorkflowRoleIds: allowedRoleIds,
      },
      metrics: {
        activeProjects: dashboardProjects.filter(
          (project) => !isClosedStatus(project.status)
        ).length,
        upcomingTasks: sortedUpcomingTasks.length,
        photosToReview,
        openRfis: openRfis.length,
        openPoAmount,
        draftOwnerUpdates,
      },
      sageBridge: {
        configured: sageBridgeConfig.configured,
        readOnly: sageBridgeConfig.readOnly,
        mode: sageBridgeConfig.mode,
        mappedProjectCount,
        mappedOperationCount,
        lastSyncedAt: lastSageSyncedAt,
        missingConfigKeys: sageBridgeConfig.missingConfigKeys,
        message: sageBridgeConfig.message,
      },
      projects: dashboardProjects,
      upcomingTasks: sortedUpcomingTasks,
      openRfis: sortedRfis,
      operations: sortedOperations,
      fieldPhotos: sortedFieldPhotos,
    }
  } catch {
    return emptyOverview()
  }
}
