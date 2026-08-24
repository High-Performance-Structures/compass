"use server"

import { revalidatePath } from "next/cache"
import { and, eq } from "drizzle-orm"

import { getDb } from "@/db"
import {
  projectExternalLinks,
  projects,
  type ProjectExternalLink,
} from "@/db/schema"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { requireOrg } from "@/lib/org-scope"
import {
  canManageProjectRegistry,
  requirePermission,
} from "@/lib/permissions"

type ProjectRegistryProject = {
  readonly id: string
  readonly projectNumber: string | null
  readonly status: string
  readonly sageJobId: string | null
  readonly sageJobNumber: string | null
  readonly googleDriveFolderId: string | null
  readonly googleScheduleSheetId: string | null
  readonly googleDailyLogSheetId: string | null
  readonly googleCalendarId: string | null
  readonly buildertrendProjectId: string | null
  readonly ownerUpdatesEnabled: boolean
  readonly ownerUpdateChannel: string
  readonly ownerUpdateCadence: string
}

export type ProjectRegistry = {
  readonly project: ProjectRegistryProject
  readonly links: readonly ProjectExternalLink[]
}

type UpdateResult =
  | { readonly success: true }
  | { readonly success: false; readonly error: string }

type LinkInput = {
  readonly system: string
  readonly label: string
  readonly externalId: string | null
  readonly externalNumber: string | null
  readonly externalUrl: string | null
  readonly syncDirection: string
  readonly syncStatus: string
  readonly metadata: string | null
}

function projectNumberPrefixName(prefix: string): string | null {
  switch (prefix) {
    case "O":
      return "Open Range Construction, Ltd."
    case "N":
      return "NuTech Systems"
    case "H":
      return "High Performance Structures"
    case "D":
      return "Design only"
    default:
      return null
  }
}

function nullableString(formData: FormData, key: string): string | null {
  const value = formData.get(key)
  if (typeof value !== "string") return null

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function projectNumberValue(formData: FormData): UpdateResult | string | null {
  const value = nullableString(formData, "projectNumber")
  if (!value) return null

  const leadingCharacter = value.slice(0, 1).toUpperCase()
  const prefix = leadingCharacter === "0" ? "O" : leadingCharacter
  const normalized = `${prefix}${value.slice(1)}`
  if (!projectNumberPrefixName(prefix)) {
    return {
      success: false,
      error:
        "Project number must start with O (Open Range Construction, Ltd.), N (NuTech Systems), H (High Performance Structures), or D (Design only).",
    }
  }

  return normalized
}

function optionValue(
  formData: FormData,
  key: string,
  allowed: readonly string[],
  fallback: string
): string {
  const value = nullableString(formData, key)
  if (!value) return fallback

  return allowed.includes(value) ? value : fallback
}

function driveFolderUrl(folderId: string | null): string | null {
  return folderId
    ? `https://drive.google.com/drive/folders/${folderId}`
    : null
}

function driveFolderIdFromUrl(value: string | null): string | null {
  if (!value) return null

  const folderMatch = value.match(/\/folders\/([^/?#]+)/)
  if (folderMatch) return folderMatch[1] ?? null

  const idMatch = value.match(/[?&]id=([^&#]+)/)
  if (idMatch) return idMatch[1] ?? null

  return null
}

function sheetUrl(sheetId: string | null): string | null {
  return sheetId
    ? `https://docs.google.com/spreadsheets/d/${sheetId}`
    : null
}

function calendarUrl(calendarId: string | null): string | null {
  return calendarId
    ? `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(calendarId)}`
    : null
}

async function verifyProjectAccess(
  projectId: string,
  action: "read" | "update"
): Promise<ReturnType<typeof getDb>> {
  const user = await requireAuth()
  requirePermission(user, "project", action)
  if (!canManageProjectRegistry(user)) {
    throw new Error("Permission denied: project registry is admin-only")
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

  return db
}

async function upsertProjectLink(
  db: ReturnType<typeof getDb>,
  projectId: string,
  input: LinkInput,
  now: string
): Promise<void> {
  const hasExternalValue =
    input.externalId !== null ||
    input.externalNumber !== null ||
    input.externalUrl !== null

  const existing = await db
    .select({ id: projectExternalLinks.id })
    .from(projectExternalLinks)
    .where(
      and(
        eq(projectExternalLinks.projectId, projectId),
        eq(projectExternalLinks.system, input.system)
      )
    )
    .limit(1)

  const existingId = existing[0]?.id

  if (!hasExternalValue) {
    if (existingId) {
      await db
        .delete(projectExternalLinks)
        .where(eq(projectExternalLinks.id, existingId))
    }
    return
  }

  if (existingId) {
    await db
      .update(projectExternalLinks)
      .set({
        label: input.label,
        externalId: input.externalId,
        externalNumber: input.externalNumber,
        externalUrl: input.externalUrl,
        syncDirection: input.syncDirection,
        syncStatus: input.syncStatus,
        metadata: input.metadata,
        updatedAt: now,
      })
      .where(eq(projectExternalLinks.id, existingId))
    return
  }

  await db.insert(projectExternalLinks).values({
    id: crypto.randomUUID(),
    projectId,
    system: input.system,
    label: input.label,
    externalId: input.externalId,
    externalNumber: input.externalNumber,
    externalUrl: input.externalUrl,
    syncDirection: input.syncDirection,
    syncStatus: input.syncStatus,
    metadata: input.metadata,
    lastSyncedAt: null,
    createdAt: now,
    updatedAt: now,
  })
}

export async function getProjectRegistry(
  projectId: string
): Promise<ProjectRegistry | null> {
  const db = await verifyProjectAccess(projectId, "read")

  const found = await db
    .select({
      id: projects.id,
      projectNumber: projects.projectNumber,
      status: projects.status,
      sageJobId: projects.sageJobId,
      sageJobNumber: projects.sageJobNumber,
      googleDriveFolderId: projects.googleDriveFolderId,
      googleScheduleSheetId: projects.googleScheduleSheetId,
      googleDailyLogSheetId: projects.googleDailyLogSheetId,
      googleCalendarId: projects.googleCalendarId,
      buildertrendProjectId: projects.buildertrendProjectId,
      ownerUpdatesEnabled: projects.ownerUpdatesEnabled,
      ownerUpdateChannel: projects.ownerUpdateChannel,
      ownerUpdateCadence: projects.ownerUpdateCadence,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  const project = found[0]
  if (!project) return null

  const links = await db
    .select()
    .from(projectExternalLinks)
    .where(eq(projectExternalLinks.projectId, projectId))

  const googleDriveLink = links.find((link) => link.system === "google_drive")
  const googleDriveFolderId =
    project.googleDriveFolderId ??
    googleDriveLink?.externalId ??
    driveFolderIdFromUrl(googleDriveLink?.externalUrl ?? null)

  return {
    project: {
      ...project,
      googleDriveFolderId,
    },
    links,
  }
}

export async function updateProjectRegistry(
  projectId: string,
  formData: FormData
): Promise<UpdateResult> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return { success: false, error: "DEMO_READ_ONLY" }
    }
    requirePermission(user, "project", "update")
    if (!canManageProjectRegistry(user)) {
      return {
        success: false,
        error: "Permission denied: project registry is admin-only",
      }
    }
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const existing = await db
      .select({ id: projects.id, projectNumber: projects.projectNumber })
      .from(projects)
      .where(
        and(eq(projects.id, projectId), eq(projects.organizationId, orgId))
      )
      .limit(1)

    if (!existing[0]) {
      return { success: false, error: "Project not found" }
    }

    const now = new Date().toISOString()
    const projectNumberResult = projectNumberValue(formData)
    if (typeof projectNumberResult === "object" && projectNumberResult) {
      return projectNumberResult
    }
    const projectNumber = projectNumberResult
    if (projectNumber !== existing[0].projectNumber) {
      return {
        success: false,
        error: "Project number corrections must use Project Information so Drive and tracker links remain synchronized.",
      }
    }
    const status = optionValue(
      formData,
      "status",
      ["OPEN", "WARRANTY", "COMPLETE", "INACTIVE", "ARCHIVE", "OTHER"],
      "OPEN"
    )
    const sageJobId = nullableString(formData, "sageJobId")
    const sageJobNumber = nullableString(formData, "sageJobNumber")
    const googleDriveFolderId = nullableString(
      formData,
      "googleDriveFolderId"
    )
    const googleScheduleSheetId = nullableString(
      formData,
      "googleScheduleSheetId"
    )
    const googleDailyLogSheetId = nullableString(
      formData,
      "googleDailyLogSheetId"
    )
    const googleCalendarId = nullableString(formData, "googleCalendarId")
    const buildertrendProjectId = nullableString(
      formData,
      "buildertrendProjectId"
    )
    const telegramChatId = nullableString(formData, "telegramChatId")
    const ownerUpdateChannel = optionValue(
      formData,
      "ownerUpdateChannel",
      ["compass", "telegram", "email"],
      "compass"
    )
    const ownerUpdateCadence = optionValue(
      formData,
      "ownerUpdateCadence",
      ["daily", "weekly", "milestone"],
      "weekly"
    )

    await db
      .update(projects)
      .set({
        projectNumber,
        status,
        sageJobId,
        sageJobNumber,
        googleDriveFolderId,
        googleScheduleSheetId,
        googleDailyLogSheetId,
        googleCalendarId,
        buildertrendProjectId,
        ownerUpdatesEnabled:
          formData.get("ownerUpdatesEnabled") === "on",
        ownerUpdateChannel,
        ownerUpdateCadence,
        updatedAt: now,
      })
      .where(eq(projects.id, projectId))

    await upsertProjectLink(db, projectId, {
      system: "sage",
      label: "Sage job ID",
      externalId: sageJobNumber ?? sageJobId,
      externalNumber: sageJobNumber,
      externalUrl: null,
      syncDirection: "bidirectional",
      syncStatus: sageJobId || sageJobNumber ? "mapped" : "unmapped",
      metadata: sageJobId
        ? JSON.stringify({
            sourceInternalId: sageJobId,
            primaryIdentifier: "projects_updated.ID",
          })
        : null,
    }, now)

    await upsertProjectLink(db, projectId, {
      system: "google_drive",
      label: "Project Drive folder",
      externalId: googleDriveFolderId,
      externalNumber: null,
      externalUrl: driveFolderUrl(googleDriveFolderId),
      syncDirection: "read_write",
      syncStatus: googleDriveFolderId ? "mapped" : "unmapped",
      metadata: null,
    }, now)

    await upsertProjectLink(db, projectId, {
      system: "google_schedule_sheet",
      label: "Schedule sheet",
      externalId: googleScheduleSheetId,
      externalNumber: null,
      externalUrl: sheetUrl(googleScheduleSheetId),
      syncDirection: "read_write",
      syncStatus: googleScheduleSheetId ? "mapped" : "unmapped",
      metadata: null,
    }, now)

    await upsertProjectLink(db, projectId, {
      system: "google_daily_log_sheet",
      label: "Daily log sheet",
      externalId: googleDailyLogSheetId,
      externalNumber: null,
      externalUrl: sheetUrl(googleDailyLogSheetId),
      syncDirection: "read",
      syncStatus: googleDailyLogSheetId ? "mapped" : "unmapped",
      metadata: null,
    }, now)

    await upsertProjectLink(db, projectId, {
      system: "google_calendar",
      label: "Milestone calendar",
      externalId: googleCalendarId,
      externalNumber: null,
      externalUrl: calendarUrl(googleCalendarId),
      syncDirection: "read_write",
      syncStatus: googleCalendarId ? "mapped" : "unmapped",
      metadata: null,
    }, now)

    await upsertProjectLink(db, projectId, {
      system: "buildertrend",
      label: "Buildertrend project",
      externalId: buildertrendProjectId,
      externalNumber: null,
      externalUrl: null,
      syncDirection: "read",
      syncStatus: buildertrendProjectId ? "mapped" : "unmapped",
      metadata: null,
    }, now)

    await upsertProjectLink(db, projectId, {
      system: "telegram_owner_updates",
      label: "Telegram photo intake",
      externalId: telegramChatId,
      externalNumber: null,
      externalUrl: null,
      syncDirection: "inbound",
      syncStatus: telegramChatId ? "mapped" : "unmapped",
      metadata: null,
    }, now)

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath("/dashboard/projects")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to update project registry",
    }
  }
}
