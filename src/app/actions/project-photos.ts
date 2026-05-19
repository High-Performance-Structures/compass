"use server"

import { and, desc, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import { dailyLogPhotos, dailyLogs, projects } from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { requireOrg } from "@/lib/org-scope"
import { requirePermission } from "@/lib/permissions"

export type ProjectPhotoLibraryItem = {
  readonly id: string
  readonly projectId: string
  readonly dailyLogId: string | null
  readonly sourceSystem: string
  readonly fileName: string
  readonly mimeType: string | null
  readonly driveUrl: string | null
  readonly thumbnailUrl: string | null
  readonly caption: string | null
  readonly capturedAt: string | null
  readonly logDate: string | null
  readonly photoDate: string
  readonly reviewStatus: string
  readonly ownerVisible: boolean
  readonly subVendorVisible: boolean
  readonly publicShareable: boolean
  readonly photoKind: string
}

export type ProjectPhotoLibrary = {
  readonly project: {
    readonly id: string
    readonly name: string
    readonly projectNumber: string | null
  }
  readonly photos: readonly ProjectPhotoLibraryItem[]
}

type PhotoPermissionInput = {
  readonly photoIds: readonly string[]
  readonly reviewStatus: string
  readonly ownerVisible: boolean
  readonly subVendorVisible: boolean
  readonly publicShareable: boolean
  readonly photoKind: string
}

type UpdateResult =
  | { readonly success: true; readonly updatedCount: number }
  | { readonly success: false; readonly error: string }

async function verifyProjectAccess(
  projectId: string,
  action: "read" | "update"
): Promise<ReturnType<typeof getDb>> {
  const user = await requireAuth()
  requirePermission(user, "project", action)
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

function normalizedReviewStatus(value: string): string {
  switch (value) {
    case "approved":
    case "needs_review":
    case "rejected":
      return value
    default:
      return "needs_review"
  }
}

function normalizedPhotoKind(value: string): string {
  switch (value) {
    case "progress":
    case "issue":
    case "delivery":
    case "selection":
    case "archive":
      return value
    default:
      return "progress"
  }
}

function photoDate(value: {
  readonly capturedAt: string | null
  readonly logDate: string | null
  readonly createdAt: string
}): string {
  if (value.capturedAt) return value.capturedAt.slice(0, 10)
  if (value.logDate) return value.logDate
  return value.createdAt.slice(0, 10)
}

function isImage(value: {
  readonly mimeType: string | null
  readonly thumbnailUrl: string | null
}): boolean {
  return value.thumbnailUrl !== null || value.mimeType?.startsWith("image/") === true
}

export async function getProjectPhotoLibrary(
  projectId: string
): Promise<ProjectPhotoLibrary> {
  const db = await verifyProjectAccess(projectId, "read")

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
    throw new Error("Project not found")
  }

  const rows = await db
    .select({
      id: dailyLogPhotos.id,
      projectId: dailyLogPhotos.projectId,
      dailyLogId: dailyLogPhotos.dailyLogId,
      sourceSystem: dailyLogPhotos.sourceSystem,
      fileName: dailyLogPhotos.fileName,
      mimeType: dailyLogPhotos.mimeType,
      driveUrl: dailyLogPhotos.driveUrl,
      thumbnailUrl: dailyLogPhotos.thumbnailUrl,
      caption: dailyLogPhotos.caption,
      capturedAt: dailyLogPhotos.capturedAt,
      reviewStatus: dailyLogPhotos.reviewStatus,
      ownerVisible: dailyLogPhotos.ownerVisible,
      subVendorVisible: dailyLogPhotos.subVendorVisible,
      publicShareable: dailyLogPhotos.publicShareable,
      photoKind: dailyLogPhotos.photoKind,
      createdAt: dailyLogPhotos.createdAt,
      logDate: dailyLogs.logDate,
    })
    .from(dailyLogPhotos)
    .leftJoin(dailyLogs, eq(dailyLogPhotos.dailyLogId, dailyLogs.id))
    .where(eq(dailyLogPhotos.projectId, projectId))
    .orderBy(desc(dailyLogPhotos.capturedAt), desc(dailyLogPhotos.createdAt))

  return {
    project,
    photos: rows.filter(isImage).map((row) => ({
      id: row.id,
      projectId: row.projectId,
      dailyLogId: row.dailyLogId,
      sourceSystem: row.sourceSystem,
      fileName: row.fileName,
      mimeType: row.mimeType,
      driveUrl: row.driveUrl,
      thumbnailUrl: row.thumbnailUrl,
      caption: row.caption,
      capturedAt: row.capturedAt,
      logDate: row.logDate,
      photoDate: photoDate({
        capturedAt: row.capturedAt,
        logDate: row.logDate,
        createdAt: row.createdAt,
      }),
      reviewStatus: row.reviewStatus,
      ownerVisible: row.ownerVisible,
      subVendorVisible: row.subVendorVisible,
      publicShareable: row.publicShareable,
      photoKind: row.photoKind,
    })),
  }
}

export async function updateProjectPhotoPermissions(
  projectId: string,
  input: PhotoPermissionInput
): Promise<UpdateResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "project", "update")
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const existing = await db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(eq(projects.id, projectId), eq(projects.organizationId, orgId))
      )
      .limit(1)

    if (!existing[0]) {
      return { success: false, error: "Project not found" }
    }

    const photoIds = [...new Set(input.photoIds)].filter(
      (id) => id.trim().length > 0
    )
    if (photoIds.length === 0) {
      return { success: false, error: "Select at least one photo." }
    }

    await db
      .update(dailyLogPhotos)
      .set({
        reviewStatus: normalizedReviewStatus(input.reviewStatus),
        ownerVisible: input.ownerVisible,
        subVendorVisible: input.subVendorVisible,
        publicShareable: input.publicShareable,
        photoKind: normalizedPhotoKind(input.photoKind),
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(dailyLogPhotos.projectId, projectId),
          inArray(dailyLogPhotos.id, photoIds)
        )
      )

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/photos`)

    return { success: true, updatedCount: photoIds.length }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to update photos",
    }
  }
}
