"use server"

import { and, asc, desc, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import { dailyLogPhotos, dailyLogs, projects, scheduleTasks } from "@/db/schema"
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
  readonly driveFileId: string | null
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
  readonly schedulePhase: string
  readonly schedulePhaseConfidence: number
  readonly schedulePhaseReason: string
}

export type ProjectPhotoPhaseOption = {
  readonly value: string
  readonly label: string
  readonly count: number
}

export type ProjectPhotoLibrary = {
  readonly project: {
    readonly id: string
    readonly name: string
    readonly projectNumber: string | null
  }
  readonly photos: readonly ProjectPhotoLibraryItem[]
  readonly phases: readonly ProjectPhotoPhaseOption[]
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

type UpdatePhotoPhaseResult =
  | { readonly success: true; readonly phase: string }
  | { readonly success: false; readonly error: string }

type PhaseSuggestion = {
  readonly phase: string
  readonly confidence: number
  readonly reason: string
}

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

function phaseKeywords(phase: string): readonly string[] {
  const normalized = phase.toLowerCase()
  const terms = new Set(
    normalized
      .split(/[^a-z0-9]+/)
      .filter((part) => part.length > 2)
  )

  const keywordGroups: readonly {
    readonly match: string
    readonly keywords: readonly string[]
  }[] = [
    {
      match: "foundation",
      keywords: ["footing", "footer", "forms", "rebar", "pour", "concrete"],
    },
    {
      match: "excavat",
      keywords: ["dig", "soil", "grading", "trench", "utility", "backfill"],
    },
    {
      match: "floor",
      keywords: ["joist", "decking", "subfloor", "rim", "beam"],
    },
    {
      match: "framing",
      keywords: ["wall", "truss", "roof", "sheathing", "stud", "plate"],
    },
    {
      match: "mechanical",
      keywords: ["hvac", "duct", "furnace", "vent", "rough"],
    },
    {
      match: "electrical",
      keywords: ["wire", "panel", "outlet", "switch", "rough"],
    },
    {
      match: "plumbing",
      keywords: ["pipe", "drain", "water", "rough", "fixture"],
    },
    {
      match: "insulation",
      keywords: ["batts", "foam", "seal", "thermal"],
    },
    {
      match: "drywall",
      keywords: ["sheetrock", "tape", "mud", "texture"],
    },
    {
      match: "finish",
      keywords: ["cabinet", "trim", "paint", "flooring", "tile", "counter"],
    },
    {
      match: "inspection",
      keywords: ["inspect", "correction", "certificate", "co", "punch"],
    },
  ]

  for (const group of keywordGroups) {
    if (normalized.includes(group.match)) {
      for (const keyword of group.keywords) terms.add(keyword)
    }
  }

  return [...terms]
}

function keywordScore(phase: string, text: string): number {
  const normalizedText = text.toLowerCase()
  return phaseKeywords(phase).reduce(
    (score, keyword) =>
      normalizedText.includes(keyword.toLowerCase()) ? score + 1 : score,
    0
  )
}

function suggestPhaseForPhoto(
  photoDateValue: string,
  contextText: string,
  tasks: readonly {
    readonly phase: string
    readonly startDate: string
    readonly endDateCalculated: string
  }[]
): PhaseSuggestion {
  const matchingTask = tasks.find(
    (task) =>
      task.phase.trim().length > 0 &&
      task.startDate <= photoDateValue &&
      task.endDateCalculated >= photoDateValue
  )

  const phaseNames = [...new Set(tasks.map((task) => task.phase))]
  const scoredPhases = phaseNames
    .map((phase) => ({
      phase,
      score: keywordScore(phase, contextText),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
  const keywordMatch = scoredPhases[0]

  if (keywordMatch && matchingTask?.phase === keywordMatch.phase) {
    return {
      phase: keywordMatch.phase,
      confidence: 92,
      reason: "Schedule date and photo context both point to this phase.",
    }
  }

  if (keywordMatch && keywordMatch.score >= 2) {
    return {
      phase: keywordMatch.phase,
      confidence: 78,
      reason: "Photo caption, filename, or daily log text matches this phase.",
    }
  }

  if (matchingTask) {
    return {
      phase: matchingTask.phase,
      confidence: 64,
      reason: "Photo date falls inside this scheduled phase.",
    }
  }

  if (keywordMatch) {
    return {
      phase: keywordMatch.phase,
      confidence: 56,
      reason: "Photo context lightly matches this phase.",
    }
  }

  return {
    phase: "Unassigned phase",
    confidence: 0,
    reason: "No schedule date or photo context match was found.",
  }
}

function phaseOptions(
  photos: readonly ProjectPhotoLibraryItem[],
  phases: readonly string[]
): readonly ProjectPhotoPhaseOption[] {
  const counts = new Map<string, number>()
  for (const photo of photos) {
    counts.set(photo.schedulePhase, (counts.get(photo.schedulePhase) ?? 0) + 1)
  }

  return [...new Set([...phases, ...counts.keys(), "Unassigned phase"])]
    .filter((phase) => phase.trim().length > 0)
    .sort((left, right) => {
      if (left === "Unassigned phase") return 1
      if (right === "Unassigned phase") return -1
      return left.localeCompare(right)
    })
    .map((value) => ({ value, label: value, count: counts.get(value) ?? 0 }))
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
      driveFileId: dailyLogPhotos.driveFileId,
      driveUrl: dailyLogPhotos.driveUrl,
      thumbnailUrl: dailyLogPhotos.thumbnailUrl,
      caption: dailyLogPhotos.caption,
      capturedAt: dailyLogPhotos.capturedAt,
      reviewStatus: dailyLogPhotos.reviewStatus,
      ownerVisible: dailyLogPhotos.ownerVisible,
      subVendorVisible: dailyLogPhotos.subVendorVisible,
      publicShareable: dailyLogPhotos.publicShareable,
      photoKind: dailyLogPhotos.photoKind,
      schedulePhaseOverride: dailyLogPhotos.schedulePhaseOverride,
      createdAt: dailyLogPhotos.createdAt,
      logDate: dailyLogs.logDate,
      logWorkCompleted: dailyLogs.workCompleted,
      logIssues: dailyLogs.issues,
      logNotes: dailyLogs.notes,
    })
    .from(dailyLogPhotos)
    .leftJoin(dailyLogs, eq(dailyLogPhotos.dailyLogId, dailyLogs.id))
    .where(eq(dailyLogPhotos.projectId, projectId))
    .orderBy(desc(dailyLogPhotos.capturedAt), desc(dailyLogPhotos.createdAt))

  const tasks = await db
    .select({
      phase: scheduleTasks.phase,
      startDate: scheduleTasks.startDate,
      endDateCalculated: scheduleTasks.endDateCalculated,
      sortOrder: scheduleTasks.sortOrder,
    })
    .from(scheduleTasks)
    .where(eq(scheduleTasks.projectId, projectId))
    .orderBy(asc(scheduleTasks.sortOrder), asc(scheduleTasks.startDate))
  const phaseNames = [...new Set(tasks.map((task) => task.phase))]

  const photos = rows.filter(isImage).map((row) => {
    const resolvedPhotoDate = photoDate({
      capturedAt: row.capturedAt,
      logDate: row.logDate,
      createdAt: row.createdAt,
    })
    const suggestion =
      row.schedulePhaseOverride && row.schedulePhaseOverride.trim().length > 0
        ? {
            phase: row.schedulePhaseOverride,
            confidence: 100,
            reason: "Phase was manually assigned during photo review.",
          }
        : suggestPhaseForPhoto(
            resolvedPhotoDate,
            [
              row.fileName,
              row.caption,
              row.photoKind,
              row.logWorkCompleted,
              row.logIssues,
              row.logNotes,
            ]
              .filter((part) => part !== null && part.trim().length > 0)
              .join(" "),
            tasks
          )

    return {
      id: row.id,
      projectId: row.projectId,
      dailyLogId: row.dailyLogId,
      sourceSystem: row.sourceSystem,
      fileName: row.fileName,
      mimeType: row.mimeType,
      driveFileId: row.driveFileId,
      driveUrl: row.driveUrl,
      thumbnailUrl: row.thumbnailUrl,
      caption: row.caption,
      capturedAt: row.capturedAt,
      logDate: row.logDate,
      photoDate: resolvedPhotoDate,
      reviewStatus: row.reviewStatus,
      ownerVisible: row.ownerVisible,
      subVendorVisible: row.subVendorVisible,
      publicShareable: row.publicShareable,
      photoKind: row.photoKind,
      schedulePhase: suggestion.phase,
      schedulePhaseConfidence: suggestion.confidence,
      schedulePhaseReason: suggestion.reason,
    }
  })

  return {
    project,
    photos,
    phases: phaseOptions(photos, phaseNames),
  }
}

export async function updateProjectPhotoPhase(
  projectId: string,
  photoId: string,
  phase: string
): Promise<UpdatePhotoPhaseResult> {
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

    const normalizedPhase = phase.trim()
    if (normalizedPhase.length === 0) {
      return { success: false, error: "Select a phase." }
    }

    await db
      .update(dailyLogPhotos)
      .set({
        schedulePhaseOverride: normalizedPhase,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(eq(dailyLogPhotos.projectId, projectId), eq(dailyLogPhotos.id, photoId))
      )

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/photos`)
    revalidatePath(`/dashboard/projects/${projectId}/preview/owner`)
    revalidatePath(`/dashboard/projects/${projectId}/preview/sub-vendor`)

    return { success: true, phase: normalizedPhase }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Unable to update photo phase",
    }
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
