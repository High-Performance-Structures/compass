import { and, eq } from "drizzle-orm"
import { NextRequest, NextResponse } from "next/server"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import {
  dailyLogs,
  dailyLogPhotos,
  projectExternalLinks,
  projects,
} from "@/db/schema"
import { googleAuth } from "@/db/schema-google"
import { requireAuth } from "@/lib/auth"
import { decrypt } from "@/lib/crypto"
import { getCloudflareContext } from "@/lib/db"
import { DriveClient } from "@/lib/google/client/drive-client"
import {
  getGoogleConfig,
  getGoogleCryptoSalt,
  parseServiceAccountKey,
} from "@/lib/google/config"
import { requireOrg } from "@/lib/org-scope"
import { isDemoUser } from "@/lib/demo"

const GOOGLE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"
const DEFAULT_PHOTO_FOLDER_NAME = "Pictures"
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024
const DEFAULT_COMPASS_GOOGLE_UPLOAD_USER = "compass@hps-colorado.com"
const NO_PHASE_VALUE = "unassigned"

type UploadPhotoResult =
  | {
      readonly success: true
      readonly uploadedCount: number
    }
  | {
      readonly success: false
      readonly error: string
    }

function isFile(value: FormDataEntryValue): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    "name" in value &&
    "size" in value &&
    "type" in value
  )
}

function formText(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === "string" ? value.trim() : ""
}

function envString(env: Record<string, string>, key: string): string | null {
  const value = env[key]?.trim()
  return value && value.length > 0 ? value : null
}

function resolveGoogleUploadEmail(input: {
  readonly userEmail: string
  readonly googleEmail: string | null
  readonly env: Record<string, string>
}): string {
  const configuredEmail = envString(input.env, "COMPASS_GOOGLE_UPLOAD_USER")
  if (configuredEmail) return configuredEmail
  if (input.googleEmail) return input.googleEmail
  if (input.userEmail.endsWith("@hps-colorado.com")) return input.userEmail
  return DEFAULT_COMPASS_GOOGLE_UPLOAD_USER
}

function normalizedSchedulePhase(value: string): string | null {
  if (value.length === 0 || value === "all" || value === NO_PHASE_VALUE) {
    return null
  }
  return value
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

function capturedAtFromDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value}T12:00:00.000Z`
  }
  return new Date().toISOString()
}

function safeFileName(value: string): string {
  const normalized = value.replace(/[/:\\]/g, "-").trim()
  return normalized.length > 0 ? normalized : "compass-upload"
}

function isImageMimeType(value: string | null): boolean {
  return value !== null && value.startsWith("image/")
}

function uploadErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string" && error.trim().length > 0) return error

  try {
    const serialized = JSON.stringify(error)
    return serialized === undefined || serialized === "{}"
      ? "Unable to upload files."
      : serialized
  } catch {
    return "Unable to upload files."
  }
}

function driveFolderIdFromUrl(value: string | null): string | null {
  if (!value) return null

  const folderMatch = value.match(/\/folders\/([^/?#]+)/)
  if (folderMatch) return folderMatch[1] ?? null

  const idMatch = value.match(/[?&]id=([^&#]+)/)
  if (idMatch) return idMatch[1] ?? null

  return null
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

async function findOrCreatePhotosFolder(
  client: DriveClient,
  googleEmail: string,
  projectFolderId: string,
  driveId: string | null
): Promise<string> {
  const candidates = [DEFAULT_PHOTO_FOLDER_NAME, "Photos"]

  for (const name of candidates) {
    const result = await client.listFiles(googleEmail, {
      folderId: projectFolderId,
      driveId: driveId ?? undefined,
      pageSize: 10,
      query:
        `mimeType = '${GOOGLE_FOLDER_MIME_TYPE}' and ` +
        `name = '${escapeDriveQueryValue(name)}'`,
    })
    const folder = result.files[0]
    if (folder) return folder.id
  }

  const folder = await client.createFolder(googleEmail, {
    name: DEFAULT_PHOTO_FOLDER_NAME,
    parentId: projectFolderId,
    driveId: driveId ?? undefined,
  })
  return folder.id
}

async function resolveUploadFolderId(
  client: DriveClient,
  googleEmail: string,
  db: ReturnType<typeof getDb>,
  projectId: string,
  projectDriveFolderId: string | null,
  sharedDriveId: string | null
): Promise<string> {
  const [photoFolderLink] = await db
    .select({
      externalId: projectExternalLinks.externalId,
      externalUrl: projectExternalLinks.externalUrl,
    })
    .from(projectExternalLinks)
    .where(
      and(
        eq(projectExternalLinks.projectId, projectId),
        eq(projectExternalLinks.system, "google_progress_photos_folder")
      )
    )
    .limit(1)

  const linkedFolderId =
    photoFolderLink?.externalId ??
    driveFolderIdFromUrl(photoFolderLink?.externalUrl ?? null)
  if (linkedFolderId) return linkedFolderId

  if (!projectDriveFolderId) {
    throw new Error("Map this project to a Google Drive folder before uploading.")
  }

  return findOrCreatePhotosFolder(
    client,
    googleEmail,
    projectDriveFolderId,
    sharedDriveId
  )
}

async function resolveProjectDriveFolderId(
  db: ReturnType<typeof getDb>,
  projectId: string,
  projectDriveFolderId: string | null
): Promise<string | null> {
  if (projectDriveFolderId) return projectDriveFolderId

  const [driveLink] = await db
    .select({
      externalId: projectExternalLinks.externalId,
      externalUrl: projectExternalLinks.externalUrl,
    })
    .from(projectExternalLinks)
    .where(
      and(
        eq(projectExternalLinks.projectId, projectId),
        eq(projectExternalLinks.system, "google_drive")
      )
    )
    .limit(1)

  return (
    driveLink?.externalId ??
    driveFolderIdFromUrl(driveLink?.externalUrl ?? null)
  )
}

export async function POST(
  request: NextRequest,
  { params }: { readonly params: Promise<{ readonly id: string }> }
): Promise<NextResponse<UploadPhotoResult>> {
  try {
    const user = await requireAuth()
    if (isDemoUser(user.id)) {
      return NextResponse.json(
        { success: false, error: "Demo mode is read-only." },
        { status: 403 }
      )
    }
    if (!user.isActive || !isInternalStaffRole(user.role)) {
      return NextResponse.json(
        { success: false, error: "Staff access is required to upload files." },
        { status: 403 }
      )
    }
    const organizationId = requireOrg(user)
    const { id: projectId } = await params

    const { env } = await getCloudflareContext()
    const envRecord = env as unknown as Record<string, string>
    const googleEmail = resolveGoogleUploadEmail({
      userEmail: user.email,
      googleEmail: user.googleEmail,
      env: envRecord,
    })
    const config = getGoogleConfig(envRecord)
    const db = getDb(env.DB)

    const [project] = await db
      .select({
        id: projects.id,
        googleDriveFolderId: projects.googleDriveFolderId,
      })
      .from(projects)
      .where(
        and(eq(projects.id, projectId), eq(projects.organizationId, organizationId))
      )
      .limit(1)

    if (!project) {
      return NextResponse.json(
        { success: false, error: "Project not found" },
        { status: 404 }
      )
    }

    const [auth] = await db.select().from(googleAuth).limit(1)
    if (!auth) {
      return NextResponse.json(
        { success: false, error: "Google Drive is not connected." },
        { status: 400 }
      )
    }

    const keyJson = await decrypt(
      auth.serviceAccountKeyEncrypted,
      config.encryptionKey,
      getGoogleCryptoSalt()
    )
    const serviceAccountKey = parseServiceAccountKey(keyJson)
    const client = new DriveClient({ serviceAccountKey })

    const formData = await request.formData()
    const files = formData.getAll("files").filter(isFile)
    if (files.length === 0) {
      return NextResponse.json(
        { success: false, error: "Choose at least one file to upload." },
        { status: 400 }
      )
    }

    const invalidFile = files.find((file) => file.size > MAX_FILE_SIZE_BYTES)
    if (invalidFile) {
      return NextResponse.json(
        {
          success: false,
          error: `${invalidFile.name} is larger than 50 MB.`,
        },
        { status: 400 }
      )
    }

    const now = new Date().toISOString()
    const caption = formText(formData, "caption")
    const capturedAt = capturedAtFromDate(formText(formData, "capturedDate"))
    const photoKind = normalizedPhotoKind(formText(formData, "photoKind"))
    const schedulePhase = formText(formData, "schedulePhase")
    const dailyLogId = formText(formData, "dailyLogId")
    const validatedDailyLogId =
      dailyLogId.length > 0
        ? await db
            .select({ id: dailyLogs.id })
            .from(dailyLogs)
            .where(
              and(
                eq(dailyLogs.id, dailyLogId),
                eq(dailyLogs.projectId, projectId)
              )
            )
            .limit(1)
            .then((rows) => rows[0]?.id ?? null)
        : null

    if (dailyLogId.length > 0 && !validatedDailyLogId) {
      return NextResponse.json(
        {
          success: false,
          error: "Daily log does not belong to this project.",
        },
        { status: 400 }
      )
    }

    const projectDriveFolderId = await resolveProjectDriveFolderId(
      db,
      projectId,
      project.googleDriveFolderId
    )

    const targetFolderId = await resolveUploadFolderId(
      client,
      googleEmail,
      db,
      projectId,
      projectDriveFolderId,
      auth.sharedDriveId
    )

    for (const file of files) {
      const mimeType = file.type || "application/octet-stream"
      const driveFile = await client.uploadFile(googleEmail, {
        name: safeFileName(file.name),
        mimeType,
        parentId: targetFolderId,
        driveId: auth.sharedDriveId ?? undefined,
        data: file,
      })

      await db.insert(dailyLogPhotos).values({
        id: crypto.randomUUID(),
        projectId,
        dailyLogId: validatedDailyLogId,
        uploadedBy: user.id,
        sourceSystem: "compass_upload",
        sourceExternalId: driveFile.id,
        fileName: driveFile.name,
        fileSize: Number(driveFile.size ?? file.size),
        mimeType: driveFile.mimeType,
        driveFileId: driveFile.id,
        driveUrl: driveFile.webViewLink ?? null,
        thumbnailUrl: isImageMimeType(driveFile.mimeType ?? mimeType)
          ? `/api/google/download/${driveFile.id}`
          : null,
        caption: caption.length > 0 ? caption : null,
        capturedAt,
        uploadStatus: "uploaded",
        reviewStatus: "needs_review",
        ownerVisible: false,
        subVendorVisible: false,
        publicShareable: false,
        photoKind,
        schedulePhaseOverride: normalizedSchedulePhase(schedulePhase),
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
      })
    }

    revalidatePath(`/dashboard/projects/${projectId}`)
    revalidatePath(`/dashboard/projects/${projectId}/photos`)
    revalidatePath(`/dashboard/projects/${projectId}/daily-logs`)
    revalidatePath(`/dashboard/projects/${projectId}/owner-updates`)

    return NextResponse.json({
      success: true,
      uploadedCount: files.length,
    })
  } catch (error) {
    console.error("Daily-log file upload failed", error)
    return NextResponse.json(
      {
        success: false,
        error: uploadErrorMessage(error),
      },
      { status: 500 }
    )
  }
}
