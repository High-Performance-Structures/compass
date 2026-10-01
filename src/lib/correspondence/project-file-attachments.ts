import { and, eq, inArray, isNotNull } from "drizzle-orm"
import { requirePermission } from "@/lib/permissions"
import { projects } from "@/db/schema"
import { projectDocuments } from "@/db/schema-documents"
import { getOrganizationDriveContext } from "@/lib/google/organization-drive"
import { getProjectDocumentDriveContext } from "@/lib/google/project-document-drive"
import { isDriveItemWithinProjectFolder } from "@/lib/google/project-folder-boundary"
import { getExportExtension, getExportMimeType, isGoogleNativeFile } from "@/lib/google/mapper"
import { correspondenceContext, type CorrespondenceContext } from "./access"
import { CorrespondenceAttachmentError, stageCorrespondenceAttachment, type StagedCorrespondenceAttachment } from "./attachment-storage"
import { boundedAttachmentBytes, MAX_CORRESPONDENCE_FILE_BYTES } from "./attachment-limits"

export type ProjectAttachmentFile = {
  readonly id: string
  readonly name: string
  readonly kind: "file" | "folder"
  readonly contentType: string
  readonly size: number | null
}
export type ProjectAttachmentFolder = {
  readonly files: readonly ProjectAttachmentFile[]
  readonly nextPageToken: string | null
}
const FOLDER_TYPE = "application/vnd.google-apps.folder"

async function staffSource(ctx: CorrespondenceContext, itemId: string | null): Promise<{
  readonly drive: Awaited<ReturnType<typeof getOrganizationDriveContext>>
  readonly folderId: string
}> {
  requirePermission(ctx.user, "document", "read")
  const project = await ctx.db.select({ folderId: projects.googleDriveFolderId }).from(projects).where(and(eq(projects.id, ctx.projectId), eq(projects.organizationId, ctx.organizationId))).get()
  if (!project?.folderId) throw new CorrespondenceAttachmentError(404, "This project's files folder is not mapped.")
  const drive = await getOrganizationDriveContext({ db: ctx.db, environment: ctx.env, organizationId: ctx.organizationId, user: ctx.user })
  const folderId = itemId ?? project.folderId
  if (!await isDriveItemWithinProjectFolder({ client: drive.client, googleEmail: drive.userEmail, itemId: folderId, projectFolderId: project.folderId })) {
    throw new CorrespondenceAttachmentError(404, "Project file not found.")
  }
  return { drive, folderId }
}

function publishedDocuments(ctx: CorrespondenceContext) {
  return ctx.db.select().from(projectDocuments).where(and(eq(projectDocuments.projectId, ctx.projectId), eq(projectDocuments.audience, "project_team"), eq(projectDocuments.downloadable, true), isNotNull(projectDocuments.publishedAt), inArray(projectDocuments.status, ["current", "superseded"])))
}

export async function listCorrespondenceProjectFiles(projectId: string, folderId: string | null, pageToken: string | null): Promise<ProjectAttachmentFolder> {
  const ctx = await correspondenceContext(projectId)
  if (ctx.workspace !== "staff") {
    // Portal users can choose only files already published for their project team.
    if (folderId || pageToken) throw new CorrespondenceAttachmentError(404, "Project folder not found.")
    const documents = await publishedDocuments(ctx)
    return { files: documents.map((file) => ({ id: file.id, name: file.title, kind: "file", contentType: file.sourceMimeType, size: null })), nextPageToken: null }
  }
  const { drive, folderId: target } = await staffSource(ctx, folderId)
  const folder = await drive.client.getFile(drive.userEmail, target)
  if (folder.mimeType !== FOLDER_TYPE || folder.trashed) throw new CorrespondenceAttachmentError(404, "Project folder not found.")
  const result = await drive.client.listFiles(drive.userEmail, { folderId: target, pageToken: pageToken ?? undefined, pageSize: 100, orderBy: "folder,name" })
  return { files: result.files.filter((file) => !file.trashed && (file.mimeType === FOLDER_TYPE || !isGoogleNativeFile(file.mimeType) || getExportMimeType(file.mimeType) !== null)).map((file) => ({ id: file.id, name: file.name, kind: file.mimeType === FOLDER_TYPE ? "folder" : "file", contentType: file.mimeType, size: file.size ? Number(file.size) : null })), nextPageToken: result.nextPageToken ?? null }
}

export async function stageCorrespondenceProjectFile(projectId: string, fileId: string): Promise<StagedCorrespondenceAttachment> {
  const ctx = await correspondenceContext(projectId)
  let source: { readonly id: string; readonly name: string; readonly contentType: string; readonly size: number | null }
  let client: Awaited<ReturnType<typeof getOrganizationDriveContext>>["client"]
  let googleEmail: string
  if (ctx.workspace === "staff") {
    const { drive } = await staffSource(ctx, fileId)
    const file = await drive.client.getFile(drive.userEmail, fileId)
    if (file.trashed || file.mimeType === FOLDER_TYPE) throw new CorrespondenceAttachmentError(404, "Project file not found.")
    source = { id: file.id, name: file.name, contentType: file.mimeType, size: file.size ? Number(file.size) : null }
    client = drive.client
    googleEmail = drive.userEmail
  } else {
    const document = (await publishedDocuments(ctx)).find((file) => file.id === fileId)
    if (!document) throw new CorrespondenceAttachmentError(404, "Project file not found.")
    const drive = await getProjectDocumentDriveContext({ db: ctx.db, env: ctx.env, organizationId: ctx.organizationId })
    source = { id: document.sourceDriveFileId, name: document.sourceFileName, contentType: document.sourceMimeType, size: null }
    client = drive.client
    googleEmail = drive.googleEmail
  }
  if (source.size !== null && source.size > MAX_CORRESPONDENCE_FILE_BYTES) throw new CorrespondenceAttachmentError(413, "The file exceeds the 25 MB per-file limit.")
  const native = isGoogleNativeFile(source.contentType)
  const contentType = native ? getExportMimeType(source.contentType) : source.contentType
  if (!contentType) throw new CorrespondenceAttachmentError(400, "This file cannot be attached.")
  const response = native ? await client.exportFile(googleEmail, source.id, contentType) : await client.downloadFile(googleEmail, source.id)
  const bytes = await boundedAttachmentBytes(response, MAX_CORRESPONDENCE_FILE_BYTES)
  const name = source.name + (native ? getExportExtension(source.contentType) : "")
  // Store a snapshot, never change the original file's ACL or parent folder.
  return stageCorrespondenceAttachment({ projectId, file: new File([bytes.slice().buffer], name, { type: contentType }) })
}
