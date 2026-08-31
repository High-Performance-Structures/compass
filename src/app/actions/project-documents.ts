"use server"

import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import { projects } from "@/db/schema"
import { contractPackets } from "@/db/schema-contracts"
import { projectDocuments } from "@/db/schema-documents"
import {
  projectEstimateBasisDocuments,
  projectEstimates,
} from "@/db/schema-estimates"
import { requireAuth, type AuthUser } from "@/lib/auth"
import { recordActivityEvent } from "@/lib/activity-log"
import { getCloudflareContext } from "@/lib/db"
import { DriveClient } from "@/lib/google/client/drive-client"
import type { DriveFile } from "@/lib/google/client/types"
import { getProjectDocumentDriveContext } from "@/lib/google/project-document-drive"
import { isDriveItemWithinProjectFolder } from "@/lib/google/project-folder-boundary"
import { requirePermission } from "@/lib/permissions"
import { assertProjectAccess } from "@/lib/project-access"
import {
  isProjectDocumentCategory,
  isProjectDocumentStatus,
} from "@/lib/project-documents"
import { isInternalStaffRole } from "@/lib/user-roles"

const GOOGLE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"
type DocumentsDb = ReturnType<typeof getDb>

export type ProjectDocumentSourceFile = {
  readonly id: string
  readonly kind: "file" | "folder"
  readonly name: string
  readonly mimeType: string
  readonly modifiedAt: string | null
  readonly path: string
  readonly webViewLink: string | null
}

export type ProjectDocumentReference = {
  readonly estimateId: string
  readonly estimateLabel: string
  readonly estimateStatus: string
  readonly contracts: readonly {
    readonly id: string
    readonly label: string
    readonly status: string
  }[]
}

export type ProjectDocumentItem = {
  readonly id: string
  readonly category: string
  readonly title: string
  readonly description: string | null
  readonly documentDate: string | null
  readonly revision: string | null
  readonly status: string
  readonly audience: string
  readonly downloadable: boolean
  readonly sourceDriveFileId: string
  readonly sourceFileName: string
  readonly sourceMimeType: string
  readonly sourceUrl: string | null
  readonly supersedesDocumentId: string | null
  readonly publishedAt: string | null
  readonly references: readonly ProjectDocumentReference[]
}

export type ProjectDocumentWorkspace = {
  readonly project: {
    readonly id: string
    readonly name: string
    readonly projectNumber: string | null
    readonly driveFolderId: string | null
  }
  readonly canManage: boolean
  readonly documents: readonly ProjectDocumentItem[]
  readonly sourceFiles: readonly ProjectDocumentSourceFile[]
  readonly sourceError: string | null
}

export type ProjectDocumentActionResult =
  | { readonly success: true; readonly id: string }
  | { readonly success: false; readonly error: string }

export type ProjectDocumentFolderResult =
  | { readonly success: true; readonly files: readonly ProjectDocumentSourceFile[] }
  | { readonly success: false; readonly error: string }

type InternalDocumentAccess = {
  readonly db: DocumentsDb
  readonly env: CloudflareEnv
  readonly user: AuthUser
  readonly organizationId: string
  readonly project: {
    readonly id: string
    readonly name: string
    readonly projectNumber: string | null
    readonly driveFolderId: string | null
  }
}

function cleanText(value: string | null): string | null {
  const cleaned = value?.trim() ?? ""
  return cleaned.length > 0 ? cleaned : null
}

function requiredText(value: string | null, label: string): string {
  const cleaned = cleanText(value)
  if (!cleaned) throw new Error(`${label} is required.`)
  return cleaned
}

function cleanDate(value: string | null): string | null {
  const cleaned = cleanText(value)
  if (!cleaned) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    throw new Error("Document date must use YYYY-MM-DD.")
  }
  return cleaned
}

async function internalDocumentAccess(
  projectId: string,
  update: boolean
): Promise<InternalDocumentAccess> {
  const user = await requireAuth()
  requirePermission(user, "document", update ? "update" : "read")
  if (!isInternalStaffRole(user.role)) {
    throw new Error("Only authorized internal staff can manage project documents.")
  }

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const access = await assertProjectAccess(db, user, projectId)
  if (!access.organizationId) throw new Error("Project organization is missing.")

  const project = await db
    .select({
      id: projects.id,
      name: projects.name,
      projectNumber: projects.projectNumber,
      driveFolderId: projects.googleDriveFolderId,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
    .then((rows) => rows[0] ?? null)
  if (!project) throw new Error("Project not found.")

  return {
    db,
    env,
    user,
    organizationId: access.organizationId,
    project,
  }
}

async function projectDriveClient(
  access: InternalDocumentAccess
): Promise<{
  readonly client: DriveClient
  readonly googleEmail: string
  readonly sharedDriveId: string | null
}> {
  return getProjectDocumentDriveContext({ db: access.db, env: access.env })
}

async function listFolderFiles(
  client: DriveClient,
  googleEmail: string,
  folderId: string,
  sharedDriveId: string | null
): Promise<readonly DriveFile[]> {
  const files: DriveFile[] = []
  let pageToken: string | undefined
  do {
    const page = await client.listFiles(googleEmail, {
      folderId,
      driveId: sharedDriveId ?? undefined,
      orderBy: "folder,name",
      pageSize: 100,
      pageToken,
    })
    files.push(...page.files)
    pageToken = page.nextPageToken
  } while (pageToken)
  return files
}

async function listProjectSourceFolder(
  access: InternalDocumentAccess,
  folderId: string,
  path: string
): Promise<readonly ProjectDocumentSourceFile[]> {
  const drive = await projectDriveClient(access)
  const files = await listFolderFiles(
    drive.client,
    drive.googleEmail,
    folderId,
    drive.sharedDriveId
  )

  return files.map((file) => ({
    id: file.id,
    kind: file.mimeType === GOOGLE_FOLDER_MIME_TYPE ? "folder" : "file",
    name: file.name,
    mimeType: file.mimeType,
    modifiedAt: file.modifiedTime ?? null,
    path,
    webViewLink: file.webViewLink ?? null,
  }))
}

function refreshDocumentPaths(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}/documents`)
  revalidatePath(`/dashboard/projects/${projectId}/estimate`)
  revalidatePath(`/dashboard/projects/${projectId}/contracts`)
  revalidatePath(`/preview/projects/${projectId}/owner/documents`)
  revalidatePath(`/preview/projects/${projectId}/sub-vendor/documents`)
}

async function documentItems(
  db: DocumentsDb,
  projectId: string
): Promise<readonly ProjectDocumentItem[]> {
  const [rows, basisRows] = await Promise.all([
    db
      .select()
      .from(projectDocuments)
      .where(eq(projectDocuments.projectId, projectId))
      .orderBy(
        asc(projectDocuments.category),
        desc(projectDocuments.documentDate),
        asc(projectDocuments.title)
      ),
    db
      .select({
        projectDocumentId: projectEstimateBasisDocuments.projectDocumentId,
        estimateId: projectEstimates.id,
        estimateNumber: projectEstimates.estimateNumber,
        versionNumber: projectEstimates.versionNumber,
        estimateStatus: projectEstimates.status,
      })
      .from(projectEstimateBasisDocuments)
      .innerJoin(
        projectEstimates,
        eq(projectEstimates.id, projectEstimateBasisDocuments.estimateId)
      )
      .where(
        and(
          eq(projectEstimateBasisDocuments.projectId, projectId),
          isNotNull(projectEstimateBasisDocuments.projectDocumentId)
        )
      ),
  ])

  const estimateIds = [...new Set(basisRows.map((row) => row.estimateId))]
  const packetRows = estimateIds.length > 0
    ? await db
        .select({
          id: contractPackets.id,
          estimateId: contractPackets.estimateId,
          packetNumber: contractPackets.packetNumber,
          versionNumber: contractPackets.versionNumber,
          status: contractPackets.status,
        })
        .from(contractPackets)
        .where(inArray(contractPackets.estimateId, estimateIds))
        .orderBy(desc(contractPackets.versionNumber))
    : []

  return rows.map((row) => ({
    id: row.id,
    category: row.category,
    title: row.title,
    description: row.description,
    documentDate: row.documentDate,
    revision: row.revision,
    status: row.status,
    audience: row.audience,
    downloadable: row.downloadable,
    sourceDriveFileId: row.sourceDriveFileId,
    sourceFileName: row.sourceFileName,
    sourceMimeType: row.sourceMimeType,
    sourceUrl: row.sourceUrl,
    supersedesDocumentId: row.supersedesDocumentId,
    publishedAt: row.publishedAt,
    references: basisRows.flatMap((basis) => {
      if (basis.projectDocumentId !== row.id) return []
      return [{
        estimateId: basis.estimateId,
        estimateLabel: `${basis.estimateNumber} v${basis.versionNumber}`,
        estimateStatus: basis.estimateStatus,
        contracts: packetRows
          .filter((packet) => packet.estimateId === basis.estimateId)
          .map((packet) => ({
            id: packet.id,
            label: `${packet.packetNumber} contract v${packet.versionNumber}`,
            status: packet.status,
          })),
      }]
    }),
  }))
}

export async function getProjectDocumentWorkspace(
  projectId: string
): Promise<ProjectDocumentWorkspace> {
  const access = await internalDocumentAccess(projectId, false)
  const documents = await documentItems(access.db, projectId)
  try {
    if (!access.project.driveFolderId) {
      throw new Error("Connect this project to its Google Drive folder first.")
    }
    const sourceFiles = await listProjectSourceFolder(
      access,
      access.project.driveFolderId,
      ""
    )
    return {
      project: access.project,
      canManage: true,
      documents,
      sourceFiles,
      sourceError: null,
    }
  } catch (error) {
    return {
      project: access.project,
      canManage: true,
      documents,
      sourceFiles: [],
      sourceError:
        error instanceof Error ? error.message : "Unable to load project files.",
    }
  }
}

export async function listProjectDocumentSourceFolder(
  projectId: string,
  folderId: string,
  path: string
): Promise<ProjectDocumentFolderResult> {
  try {
    const access = await internalDocumentAccess(projectId, false)
    if (!access.project.driveFolderId) {
      throw new Error("Connect this project to its Google Drive folder first.")
    }
    const cleanedFolderId = requiredText(folderId, "Folder")
    const cleanedPath = path.trim().slice(0, 1_000)
    if (cleanedFolderId !== access.project.driveFolderId) {
      const drive = await projectDriveClient(access)
      const withinProject = await isDriveItemWithinProjectFolder({
        client: drive.client,
        googleEmail: drive.googleEmail,
        itemId: cleanedFolderId,
        projectFolderId: access.project.driveFolderId,
      })
      if (!withinProject) throw new Error("That folder is outside this project.")
    }
    const files = await listProjectSourceFolder(
      access,
      cleanedFolderId,
      cleanedPath
    )
    return { success: true, files }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to load that project folder.",
    }
  }
}

export async function publishProjectDocument(
  projectId: string,
  input: {
    readonly sourceDriveFileId: string | null
    readonly category: string | null
    readonly title: string | null
    readonly description: string | null
    readonly documentDate: string | null
    readonly revision: string | null
    readonly supersedesDocumentId: string | null
  }
): Promise<ProjectDocumentActionResult> {
  try {
    const access = await internalDocumentAccess(projectId, true)
    requirePermission(access.user, "document", "create")
    if (!access.project.driveFolderId) {
      throw new Error("Connect this project to its Google Drive folder first.")
    }
    const sourceDriveFileId = requiredText(input.sourceDriveFileId, "Source file")
    const category = requiredText(input.category, "Document category")
    if (!isProjectDocumentCategory(category)) {
      throw new Error("Choose a supported construction-document category.")
    }

    const duplicate = await access.db
      .select({ id: projectDocuments.id })
      .from(projectDocuments)
      .where(
        and(
          eq(projectDocuments.projectId, projectId),
          eq(projectDocuments.sourceDriveFileId, sourceDriveFileId)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (duplicate) throw new Error("That Drive file is already published.")

    const drive = await projectDriveClient(access)
    const withinProject = await isDriveItemWithinProjectFolder({
      client: drive.client,
      googleEmail: drive.googleEmail,
      itemId: sourceDriveFileId,
      projectFolderId: access.project.driveFolderId,
    })
    if (!withinProject) throw new Error("The selected file is outside this project folder.")

    const source = await drive.client.getFile(drive.googleEmail, sourceDriveFileId)
    if (source.mimeType === GOOGLE_FOLDER_MIME_TYPE) {
      throw new Error("Choose a file rather than a folder.")
    }

    const supersedesDocumentId = cleanText(input.supersedesDocumentId)
    if (supersedesDocumentId) {
      const prior = await access.db
        .select({ id: projectDocuments.id, status: projectDocuments.status })
        .from(projectDocuments)
        .where(
          and(
            eq(projectDocuments.id, supersedesDocumentId),
            eq(projectDocuments.projectId, projectId)
          )
        )
        .limit(1)
        .then((rows) => rows[0] ?? null)
      if (!prior || prior.status !== "current") {
        throw new Error("Choose a current project document to supersede.")
      }
    }

    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const title = cleanText(input.title) ?? source.name
    const insertDocument = access.db.insert(projectDocuments).values({
        id,
        projectId,
        category,
        title,
        description: cleanText(input.description),
        documentDate: cleanDate(input.documentDate),
        revision: cleanText(input.revision),
        status: "current",
        audience: "project_team",
        downloadable: true,
        sourceDriveFileId,
        sourceFileName: source.name,
        sourceMimeType: source.mimeType,
        sourceUrl: source.webViewLink ?? null,
        sourceChecksum: null,
        supersedesDocumentId,
        publishedBy: access.user.id,
        publishedAt: now,
        archivedAt: null,
        createdBy: access.user.id,
        createdAt: now,
        updatedAt: now,
      })
    if (supersedesDocumentId) {
      await access.db.batch([
        access.db
          .update(projectDocuments)
          .set({ status: "superseded", updatedAt: now })
          .where(
            and(
              eq(projectDocuments.id, supersedesDocumentId),
              eq(projectDocuments.projectId, projectId)
            )
          ),
        insertDocument,
      ])
    } else {
      await insertDocument.run()
    }
    await recordActivityEvent({
      db: access.db,
      organizationId: access.organizationId,
      projectId,
      actor: access.user,
      category: "file",
      action: "project_document.published",
      entityType: "project_document",
      entityId: id,
      summary: `Published ${title} to the entire project team.`,
      metadata: { category, revision: cleanText(input.revision) },
    })
    refreshDocumentPaths(projectId)
    return { success: true, id }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to publish document.",
    }
  }
}

export async function updateProjectDocumentStatus(
  projectId: string,
  documentId: string,
  status: string
): Promise<ProjectDocumentActionResult> {
  try {
    const access = await internalDocumentAccess(projectId, true)
    if (!isProjectDocumentStatus(status) || status === "draft") {
      throw new Error("Choose current, superseded, or archived status.")
    }
    const existing = await access.db
      .select({ id: projectDocuments.id, title: projectDocuments.title })
      .from(projectDocuments)
      .where(
        and(
          eq(projectDocuments.id, documentId),
          eq(projectDocuments.projectId, projectId)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!existing) throw new Error("Project document not found.")
    const now = new Date().toISOString()
    await access.db
      .update(projectDocuments)
      .set({
        status,
        archivedAt: status === "archived" ? now : null,
        updatedAt: now,
      })
      .where(eq(projectDocuments.id, documentId))
      .run()
    await recordActivityEvent({
      db: access.db,
      organizationId: access.organizationId,
      projectId,
      actor: access.user,
      category: "file",
      action: "project_document.status_changed",
      entityType: "project_document",
      entityId: documentId,
      summary: `Changed ${existing.title} to ${status}.`,
      metadata: { status },
    })
    refreshDocumentPaths(projectId)
    return { success: true, id: documentId }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to update document.",
    }
  }
}

export async function deleteProjectDocument(
  projectId: string,
  documentId: string
): Promise<ProjectDocumentActionResult> {
  try {
    const access = await internalDocumentAccess(projectId, true)
    requirePermission(access.user, "document", "delete")
    const existing = await access.db
      .select({
        id: projectDocuments.id,
        title: projectDocuments.title,
        status: projectDocuments.status,
      })
      .from(projectDocuments)
      .where(
        and(
          eq(projectDocuments.id, documentId),
          eq(projectDocuments.projectId, projectId)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!existing) throw new Error("Project document not found.")
    if (existing.status !== "archived" && existing.status !== "draft") {
      throw new Error("Archive a published document before deleting its record.")
    }
    const estimateReference = await access.db
      .select({ id: projectEstimateBasisDocuments.id })
      .from(projectEstimateBasisDocuments)
      .where(eq(projectEstimateBasisDocuments.projectDocumentId, documentId))
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (estimateReference) {
      throw new Error(
        "This document is part of an estimate or contract basis and must be retained."
      )
    }
    await access.db
      .delete(projectDocuments)
      .where(
        and(
          eq(projectDocuments.id, documentId),
          eq(projectDocuments.projectId, projectId)
        )
      )
      .run()
    await recordActivityEvent({
      db: access.db,
      organizationId: access.organizationId,
      projectId,
      actor: access.user,
      category: "file",
      action: "project_document.deleted",
      entityType: "project_document",
      entityId: documentId,
      summary: `Deleted the archived publication record for ${existing.title}.`,
    })
    refreshDocumentPaths(projectId)
    return { success: true, id: documentId }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to delete document.",
    }
  }
}
