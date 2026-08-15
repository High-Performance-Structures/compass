import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { NextResponse } from "next/server"

import { getDb } from "@/db"
import {
  projectAudienceFiles,
  projectExternalLinks,
  projectExternalResourceGrants,
  projects,
} from "@/db/schema"
import { recordActivityEvent } from "@/lib/activity-log"
import { requireProjectAudienceFileAccess } from "@/lib/project-audience-file-access"
import {
  findOrCreateProjectAudienceFolder,
  projectAudienceDriveClient,
} from "@/lib/project-audience-file-drive"
import {
  EXTERNAL_PROJECT_FILE_ROLLING_DAYS,
  validateExternalProjectFileContents,
  validateExternalProjectFileUploadLimits,
} from "@/lib/project-audience-file-policy"
import type { ProjectAudience } from "@/lib/project-audience-access"
import { getCloudflareContext } from "@/lib/db"

function audienceFromParam(value: string): ProjectAudience | null {
  if (value === "owner" || value === "sub-vendor") {
    return value === "sub-vendor" ? "sub_vendor" : value
  }
  return null
}

type ProjectAudienceFileAccess = Awaited<
  ReturnType<typeof requireProjectAudienceFileAccess>
>

function projectAudienceAccessFailure(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : ""
  if (message === "Unauthorized") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (message === "Project not found") {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 })
}

async function getProjectAudienceFileAccess(input: {
  readonly projectId: string
  readonly audience: ProjectAudience
}): Promise<
  | { readonly access: ProjectAudienceFileAccess }
  | { readonly response: NextResponse }
> {
  try {
    return {
      access: await requireProjectAudienceFileAccess(input),
    }
  } catch (error) {
    return { response: projectAudienceAccessFailure(error) }
  }
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

function safeFileName(value: string): string {
  const normalized = value.replace(/[/:\\]/g, "-").trim()
  return (normalized.length > 0 ? normalized : "project-file").slice(0, 180)
}

function driveFolderIdFromUrl(value: string | null): string | null {
  if (!value) return null
  const folderMatch = value.match(/\/folders\/([^/?#]+)/)
  if (folderMatch) return folderMatch[1] ?? null
  const idMatch = value.match(/[?&]id=([^&#]+)/)
  return idMatch?.[1] ?? null
}

async function projectFolderId(input: {
  readonly db: ReturnType<typeof getDb>
  readonly organizationId: string
  readonly projectId: string
}): Promise<string> {
  const project = await input.db
    .select({ googleDriveFolderId: projects.googleDriveFolderId })
    .from(projects)
    .where(
      and(
        eq(projects.id, input.projectId),
        eq(projects.organizationId, input.organizationId)
      )
    )
    .get()
  if (!project) throw new Error("Project not found")
  if (project.googleDriveFolderId) return project.googleDriveFolderId

  const link = await input.db
    .select({
      externalId: projectExternalLinks.externalId,
      externalUrl: projectExternalLinks.externalUrl,
    })
    .from(projectExternalLinks)
    .where(
      and(
        eq(projectExternalLinks.projectId, input.projectId),
        eq(projectExternalLinks.system, "google_drive")
      )
    )
    .get()
  const linkedFolderId =
    link?.externalId ?? driveFolderIdFromUrl(link?.externalUrl ?? null)
  if (!linkedFolderId) {
    throw new Error("Project files are not connected to Google Drive yet.")
  }
  return linkedFolderId
}

function quotaStart(now: Date): string {
  return new Date(
    now.getTime() - EXTERNAL_PROJECT_FILE_ROLLING_DAYS * 24 * 60 * 60 * 1000
  ).toISOString()
}

export async function GET(
  _request: Request,
  {
    params,
  }: {
    readonly params: Promise<{
      readonly id: string
      readonly audience: string
    }>
  }
): Promise<Response> {
  try {
    const { id: projectId, audience: audienceParam } = await params
    const audience = audienceFromParam(audienceParam)
    if (!audience) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const accessResult = await getProjectAudienceFileAccess({ projectId, audience })
    if ("response" in accessResult) return accessResult.response
    const { access } = accessResult
    const fileFields = {
      id: projectAudienceFiles.id,
      fileName: projectAudienceFiles.fileName,
      mimeType: projectAudienceFiles.mimeType,
      fileSize: projectAudienceFiles.fileSize,
      createdAt: projectAudienceFiles.createdAt,
      uploadedAt: projectAudienceFiles.uploadedAt,
    }
    const files = access.viewerIsInternal
      ? await access.db
          .select(fileFields)
          .from(projectAudienceFiles)
          .where(
            and(
              eq(projectAudienceFiles.organizationId, access.organizationId),
              eq(projectAudienceFiles.projectId, projectId),
              eq(projectAudienceFiles.audience, audience),
              eq(projectAudienceFiles.uploadStatus, "uploaded")
            )
          )
          .orderBy(desc(projectAudienceFiles.createdAt))
      : await access.db
          .select(fileFields)
          .from(projectAudienceFiles)
          .innerJoin(
            projectExternalResourceGrants,
            and(
              eq(projectExternalResourceGrants.organizationId, access.organizationId),
              eq(projectExternalResourceGrants.projectId, projectId),
              eq(projectExternalResourceGrants.resourceType, "audience_file"),
              eq(projectExternalResourceGrants.resourceId, projectAudienceFiles.id),
              eq(projectExternalResourceGrants.recipientUserId, access.user.id),
              isNull(projectExternalResourceGrants.revokedAt)
            )
          )
          .where(
            and(
              eq(projectAudienceFiles.organizationId, access.organizationId),
              eq(projectAudienceFiles.projectId, projectId),
              eq(projectAudienceFiles.uploadStatus, "uploaded")
            )
          )
          .orderBy(desc(projectAudienceFiles.createdAt))

    return NextResponse.json({
      files: files.map((file) => ({
        ...file,
        downloadUrl: `/api/projects/${encodeURIComponent(projectId)}/audience-files/${audienceParam}/${encodeURIComponent(file.id)}`,
      })),
    })
  } catch {
    return NextResponse.json(
      { error: "Unable to load project files." },
      { status: 500 }
    )
  }
}

export async function POST(
  request: Request,
  {
    params,
  }: {
    readonly params: Promise<{
      readonly id: string
      readonly audience: string
    }>
  }
): Promise<Response> {
  try {
    const { id: projectId, audience: audienceParam } = await params
    const audience = audienceFromParam(audienceParam)
    if (!audience) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const accessResult = await getProjectAudienceFileAccess({ projectId, audience })
    if ("response" in accessResult) return accessResult.response
    const { access } = accessResult
    if (access.viewerIsInternal) {
      return NextResponse.json(
        { error: "Use Project Files to upload on behalf of the project team." },
        { status: 403 }
      )
    }

    const formData = await request.formData()
    const files = formData.getAll("files").filter(isFile)
    const now = new Date()
    const shapeValidation = validateExternalProjectFileUploadLimits({
      existingBytes: 0,
      files: files.map((file) => ({ size: file.size })),
    })
    if (!shapeValidation.ok) {
      return NextResponse.json({ error: shapeValidation.error }, { status: 400 })
    }

    const filesWithBytes = await Promise.all(
      files.map(async (file) => ({
        file,
        bytes: new Uint8Array(await file.slice(0, 4096).arrayBuffer()),
      }))
    )
    const contentValidation = validateExternalProjectFileContents(
      filesWithBytes.map(({ file, bytes }) => ({ name: file.name, bytes }))
    )
    if (!contentValidation.ok) {
      return NextResponse.json({ error: contentValidation.error }, { status: 400 })
    }
    const validatedFiles = filesWithBytes.map(({ file }, index) => {
      const mimeType = contentValidation.mimeTypes[index]
      if (!mimeType) {
        throw new Error("Validated project file content was missing its MIME type.")
      }
      return { file, mimeType }
    })

    const existing = await access.db
      .select({ total: sql<number>`coalesce(sum(${projectAudienceFiles.fileSize}), 0)` })
      .from(projectAudienceFiles)
      .where(
        and(
          eq(projectAudienceFiles.organizationId, access.organizationId),
          eq(projectAudienceFiles.projectId, projectId),
          eq(projectAudienceFiles.uploadedBy, access.user.id),
          inArray(projectAudienceFiles.uploadStatus, ["pending", "uploaded"]),
          gte(projectAudienceFiles.createdAt, quotaStart(now))
        )
      )
      .get()
    const limits = validateExternalProjectFileUploadLimits({
      existingBytes: Number(existing?.total ?? 0),
      files: files.map((file) => ({ size: file.size })),
    })
    if (!limits.ok) {
      return NextResponse.json({ error: limits.error }, { status: 400 })
    }

    const { env } = await getCloudflareContext()
    const envRecord = env as unknown as Record<string, string>
    const drive = await projectAudienceDriveClient({
      db: access.db,
      env: envRecord,
      googleEmail: access.user.googleEmail,
      organizationId: access.organizationId,
      userEmail: access.user.email,
    })
    const folderId = await findOrCreateProjectAudienceFolder({
      client: drive.client,
      googleEmail: drive.googleEmail,
      sharedDriveId: drive.sharedDriveId,
      projectFolderId: await projectFolderId({
        db: access.db,
        organizationId: access.organizationId,
        projectId,
      }),
      audience,
    })
    const createdAt = now.toISOString()
    const pending = validatedFiles.map(({ file, mimeType }) => ({
      id: crypto.randomUUID(),
      organizationId: access.organizationId,
      projectId,
      audience,
      uploadedBy: access.user.id,
      folderId,
      driveFileId: null,
      driveUrl: null,
      fileName: safeFileName(file.name),
      mimeType,
      fileSize: file.size,
      uploadStatus: "pending",
      createdAt,
      uploadedAt: null,
    }))
    try {
      await access.db.insert(projectAudienceFiles).values(pending)
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("external project file rolling quota exceeded")
      ) {
        return NextResponse.json(
          {
            error:
              "This upload would exceed your 100 MB project allowance for the last 30 days.",
          },
          { status: 409 }
        )
      }
      throw error
    }

    const uploaded: { readonly id: string; readonly fileName: string }[] = []
    try {
      for (const [index, validatedFile] of validatedFiles.entries()) {
        const driveFile = await drive.client.uploadFile(drive.googleEmail, {
          name: pending[index].fileName,
          mimeType: pending[index].mimeType,
          parentId: folderId,
          driveId: drive.sharedDriveId ?? undefined,
          data: validatedFile.file,
        })
        const uploadedAt = new Date().toISOString()
        await access.db
          .update(projectAudienceFiles)
          .set({
            driveFileId: driveFile.id,
            driveUrl: driveFile.webViewLink ?? null,
            uploadStatus: "uploaded",
            uploadedAt,
          })
          .where(eq(projectAudienceFiles.id, pending[index].id))
        await access.db.insert(projectExternalResourceGrants).values({
          id: crypto.randomUUID(),
          organizationId: access.organizationId,
          projectId,
          resourceType: "audience_file",
          resourceId: pending[index].id,
          recipientUserId: access.user.id,
          grantedBy: access.user.id,
          grantedAt: uploadedAt,
          revokedBy: null,
          revokedAt: null,
        })
        uploaded.push({ id: pending[index].id, fileName: pending[index].fileName })
      }
    } catch (error) {
      await access.db
        .delete(projectAudienceFiles)
        .where(
          and(
            inArray(
              projectAudienceFiles.id,
              pending.map((file) => file.id)
            ),
            eq(projectAudienceFiles.uploadStatus, "pending")
          )
        )
      console.error("Project audience file upload failed", {
        audience,
        errorName: error instanceof Error ? error.name : "UnknownError",
        organizationId: access.organizationId,
        projectId,
      })
      return NextResponse.json(
        {
          error: "Some files could not be uploaded.",
          uploaded,
        },
        { status: 502 }
      )
    }

    await recordActivityEvent({
      db: access.db,
      organizationId: access.organizationId,
      projectId,
      actor: access.user,
      category: "file",
      action: "project.audience_files_uploaded",
      entityType: "project_audience_file_batch",
      summary: `Uploaded ${uploaded.length} ${audience === "owner" ? "owner" : "sub-supplier"} project file${uploaded.length === 1 ? "" : "s"}.`,
      metadata: { audience, fileCount: uploaded.length },
    })
    revalidatePath(`/preview/projects/${projectId}/${audienceParam}/files`)
    revalidatePath(`/dashboard/files`)

    return NextResponse.json({ uploaded })
  } catch {
    return NextResponse.json(
      { error: "Unable to upload project files." },
      { status: 500 }
    )
  }
}
