"use server"

import { and, asc, desc, eq, inArray, not, sql } from "drizzle-orm"

import { getDb } from "@/db"
import {
  dailyLogPhotos,
  ownerProjectUpdates,
  projectMembers,
  projectRfis,
  projects,
} from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { requireOrg } from "@/lib/org-scope"
import { canFeature } from "@/lib/permission-enforcement"
import { dailyLogPhotoCollectionEligibility } from "@/lib/photos/collection-eligibility"
import { canUseOrganizationProjectScopeRole } from "@/lib/user-roles"

export type OfficeAlertRfi = {
  readonly id: string
  readonly projectId: string
  readonly projectLabel: string
  readonly projectName: string
  readonly rfiNumber: string
  readonly subject: string
  readonly priority: string
  readonly status: string
  readonly dueDate: string | null
  readonly assignedToName: string | null
}

export type OfficeAlertPhoto = {
  readonly id: string
  readonly projectId: string
  readonly projectLabel: string
  readonly projectName: string
  readonly fileName: string
  readonly caption: string | null
  readonly photoKind: string
  readonly capturedAt: string | null
  readonly createdAt: string
}

export type OfficeAlertOwnerUpdate = {
  readonly id: string
  readonly projectId: string
  readonly projectLabel: string
  readonly projectName: string
  readonly title: string
  readonly updateDate: string
  readonly updatedAt: string
}

export type OfficeAlertQueue = {
  readonly rfis: readonly OfficeAlertRfi[]
  readonly photos: readonly OfficeAlertPhoto[]
  readonly ownerUpdates: readonly OfficeAlertOwnerUpdate[]
}

type AccessibleProject = {
  readonly id: string
  readonly name: string
  readonly projectNumber: string | null
}

type OfficeAlertRfiRow = Omit<
  OfficeAlertRfi,
  "projectLabel" | "projectName"
>

type OfficeAlertPhotoRow = Omit<
  OfficeAlertPhoto,
  "projectLabel" | "projectName"
>

type OfficeAlertOwnerUpdateRow = Omit<
  OfficeAlertOwnerUpdate,
  "projectLabel" | "projectName"
>

const EMPTY_QUEUE: OfficeAlertQueue = {
  rfis: [],
  photos: [],
  ownerUpdates: [],
}

function isClosedStatus(status: string): boolean {
  const normalized = status.toLowerCase()
  return (
    normalized === "complete" ||
    normalized === "completed" ||
    normalized === "done" ||
    normalized === "closed" ||
    normalized === "void" ||
    normalized === "inactive" ||
    normalized === "archive" ||
    normalized === "archived" ||
    normalized === "cancelled" ||
    normalized === "canceled"
  )
}

function projectLabel(project: AccessibleProject): string {
  return project.projectNumber ?? project.name
}

export async function getOfficeAlertQueue(): Promise<OfficeAlertQueue> {
  const user = await requireAuth()
  const orgId = requireOrg(user)
  if (user.organizationType !== "internal") return EMPTY_QUEUE

  const { env } = await getCloudflareContext()
  if (!env?.DB) return EMPTY_QUEUE

  const db = getDb(env.DB)
  const hasOrganizationScope = canUseOrganizationProjectScopeRole(user.role)

  const accessibleProjects: readonly AccessibleProject[] = hasOrganizationScope
    ? await db
        .select({
          id: projects.id,
          name: projects.name,
          projectNumber: projects.projectNumber,
        })
        .from(projects)
        .where(eq(projects.organizationId, orgId))
        .orderBy(asc(projects.projectNumber), asc(projects.name))
    : await db
        .select({
          id: projects.id,
          name: projects.name,
          projectNumber: projects.projectNumber,
        })
        .from(projectMembers)
        .innerJoin(projects, eq(projectMembers.projectId, projects.id))
        .where(
          and(
            eq(projectMembers.userId, user.id),
            eq(projects.organizationId, orgId)
          )
        )
        .orderBy(asc(projects.projectNumber), asc(projects.name))

  if (accessibleProjects.length === 0) return EMPTY_QUEUE

  const projectIds = accessibleProjects.map((project) => project.id)
  const projectsById = new Map(
    accessibleProjects.map((project) => [project.id, project])
  )
  const [canReadRfis, canReadPhotos, canReadOwnerUpdates] = await Promise.all([
    canFeature(user, "rfis", "read"),
    canFeature(user, "project-photos", "read"),
    canFeature(user, "owner-updates", "read"),
  ])

  const rfiRows: OfficeAlertRfiRow[] = []
  const photoRows: OfficeAlertPhotoRow[] = []
  const ownerUpdateRows: OfficeAlertOwnerUpdateRow[] = []
  const projectBatchSize = 80

  // D1 has a low parameter ceiling, and imported organizations can contain
  // hundreds of projects. Keep every cross-project IN predicate bounded.
  for (let index = 0; index < projectIds.length; index += projectBatchSize) {
    const batchProjectIds = projectIds.slice(index, index + projectBatchSize)
    const [rfiBatch, photoBatch, ownerUpdateBatch] = await Promise.all([
      canReadRfis
        ? db
            .select({
              id: projectRfis.id,
              projectId: projectRfis.projectId,
              rfiNumber: projectRfis.rfiNumber,
              subject: projectRfis.subject,
              priority: projectRfis.priority,
              status: projectRfis.status,
              dueDate: projectRfis.dueDate,
              assignedToName: projectRfis.assignedToName,
            })
            .from(projectRfis)
            .where(inArray(projectRfis.projectId, batchProjectIds))
            .orderBy(asc(projectRfis.dueDate), asc(projectRfis.rfiNumber))
        : Promise.resolve([]),
      canReadPhotos
        ? db
            .select({
              id: dailyLogPhotos.id,
              projectId: dailyLogPhotos.projectId,
              fileName: dailyLogPhotos.fileName,
              caption: dailyLogPhotos.caption,
              photoKind: dailyLogPhotos.photoKind,
              capturedAt: dailyLogPhotos.capturedAt,
              createdAt: dailyLogPhotos.createdAt,
            })
            .from(dailyLogPhotos)
            .where(
              and(
                inArray(dailyLogPhotos.projectId, batchProjectIds),
                eq(dailyLogPhotos.reviewStatus, "needs_review"),
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
                    AND (
                      canonical.drive_file_id IS NOT NULL
                      OR canonical.thumbnail_url IS NOT NULL
                    )
                )`),
              )
            )
            .orderBy(
              desc(dailyLogPhotos.capturedAt),
              desc(dailyLogPhotos.createdAt)
            )
        : Promise.resolve([]),
      canReadOwnerUpdates
        ? db
            .select({
              id: ownerProjectUpdates.id,
              projectId: ownerProjectUpdates.projectId,
              title: ownerProjectUpdates.title,
              updateDate: ownerProjectUpdates.updateDate,
              updatedAt: ownerProjectUpdates.updatedAt,
            })
            .from(ownerProjectUpdates)
            .where(
              and(
                inArray(ownerProjectUpdates.projectId, batchProjectIds),
                eq(ownerProjectUpdates.status, "draft")
              )
            )
            .orderBy(
              desc(ownerProjectUpdates.updateDate),
              desc(ownerProjectUpdates.updatedAt)
            )
        : Promise.resolve([]),
    ])

    rfiRows.push(...rfiBatch)
    photoRows.push(...photoBatch)
    ownerUpdateRows.push(...ownerUpdateBatch)
  }

  rfiRows.sort(
    (left, right) =>
      (left.dueDate ?? "9999-12-31").localeCompare(
        right.dueDate ?? "9999-12-31"
      ) || left.rfiNumber.localeCompare(right.rfiNumber)
  )
  photoRows.sort((left, right) =>
    (right.capturedAt ?? right.createdAt).localeCompare(
      left.capturedAt ?? left.createdAt
    )
  )
  ownerUpdateRows.sort(
    (left, right) =>
      right.updateDate.localeCompare(left.updateDate) ||
      right.updatedAt.localeCompare(left.updatedAt)
  )

  const rfis: OfficeAlertRfi[] = []
  for (const rfi of rfiRows) {
    if (isClosedStatus(rfi.status)) continue
    const project = projectsById.get(rfi.projectId)
    if (!project) continue
    rfis.push({
      ...rfi,
      projectLabel: projectLabel(project),
      projectName: project.name,
    })
  }

  const photos: OfficeAlertPhoto[] = []
  for (const photo of photoRows) {
    const project = projectsById.get(photo.projectId)
    if (!project) continue
    photos.push({
      ...photo,
      projectLabel: projectLabel(project),
      projectName: project.name,
    })
  }

  const ownerUpdates: OfficeAlertOwnerUpdate[] = []
  for (const update of ownerUpdateRows) {
    const project = projectsById.get(update.projectId)
    if (!project) continue
    ownerUpdates.push({
      ...update,
      projectLabel: projectLabel(project),
      projectName: project.name,
    })
  }

  return { rfis, photos, ownerUpdates }
}
