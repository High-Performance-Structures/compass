"use server"

import { and, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import { projects } from "@/db/schema"
import { projectDocuments } from "@/db/schema-documents"
import { recordActivityEvent } from "@/lib/activity-log"
import { requireAuth } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { chunkD1Values } from "@/lib/d1-query"
import { getProjectDocumentDriveContext } from "@/lib/google/project-document-drive"
import { collectPublishableProjectDocumentFolderFiles } from "@/lib/google/project-document-folder-publishing"
import { isDriveItemWithinProjectFolder } from "@/lib/google/project-folder-boundary"
import { requirePermission } from "@/lib/permissions"
import { assertProjectAccess } from "@/lib/project-access"
import {
  isProjectDocumentCategory,
  projectDocumentTitleFromFileName,
} from "@/lib/project-documents"
import { isInternalStaffRole } from "@/lib/user-roles"

const GOOGLE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"

export type ProjectDocumentFolderPublishResult =
  | {
      readonly success: true
      readonly publishedCount: number
      readonly skippedCount: number
    }
  | { readonly success: false; readonly error: string }

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

function refreshDocumentPaths(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}/documents`)
  revalidatePath(`/dashboard/projects/${projectId}/estimate`)
  revalidatePath(`/dashboard/projects/${projectId}/contracts`)
  revalidatePath(`/preview/projects/${projectId}/owner/documents`)
  revalidatePath(`/preview/projects/${projectId}/sub-vendor/documents`)
}

export async function publishProjectDocumentFolder(
  projectId: string,
  input: {
    readonly sourceDriveFolderId: string | null
    readonly category: string | null
    readonly description: string | null
    readonly documentDate: string | null
    readonly revision: string | null
  }
): Promise<ProjectDocumentFolderPublishResult> {
  try {
    const user = await requireAuth()
    requirePermission(user, "document", "update")
    requirePermission(user, "document", "create")
    if (!isInternalStaffRole(user.role)) {
      throw new Error("Only authorized internal staff can manage project documents.")
    }
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const access = await assertProjectAccess(db, user, projectId)
    if (!access.organizationId) throw new Error("Project organization is missing.")
    const project = await db
      .select({ driveFolderId: projects.googleDriveFolderId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (!project) throw new Error("Project not found.")
    if (!project.driveFolderId) {
      throw new Error("Connect this project to its Google Drive folder first.")
    }

    const sourceDriveFolderId = requiredText(
      input.sourceDriveFolderId,
      "Source folder"
    )
    const category = requiredText(input.category, "Document category")
    if (!isProjectDocumentCategory(category)) {
      throw new Error("Choose a supported construction-document category.")
    }
    const drive = await getProjectDocumentDriveContext({ db, env })
    if (sourceDriveFolderId !== project.driveFolderId) {
      const withinProject = await isDriveItemWithinProjectFolder({
        client: drive.client,
        googleEmail: drive.googleEmail,
        itemId: sourceDriveFolderId,
        projectFolderId: project.driveFolderId,
      })
      if (!withinProject) {
        throw new Error("The selected folder is outside this project folder.")
      }
    }
    const sourceFolder = await drive.client.getFile(
      drive.googleEmail,
      sourceDriveFolderId
    )
    if (sourceFolder.mimeType !== GOOGLE_FOLDER_MIME_TYPE) {
      throw new Error("Choose a folder rather than a file.")
    }

    const collected = await collectPublishableProjectDocumentFolderFiles({
      folderId: sourceDriveFolderId,
      listFolderItems: async (folderId) => {
        const files = []
        let pageToken: string | undefined
        do {
          const page = await drive.client.listFiles(drive.googleEmail, {
            folderId,
            driveId: drive.sharedDriveId ?? undefined,
            orderBy: "folder,name",
            pageSize: 100,
            pageToken,
          })
          files.push(...page.files)
          pageToken = page.nextPageToken
        } while (pageToken)
        return files
      },
    })
    if (collected.files.length === 0) {
      throw new Error("That folder does not contain any downloadable documents.")
    }

    const sourceIds = collected.files.map((file) => file.id)
    const duplicateRows = (
      await Promise.all(
        chunkD1Values(sourceIds).map((sourceIdChunk) =>
          db
            .select({ sourceDriveFileId: projectDocuments.sourceDriveFileId })
            .from(projectDocuments)
            .where(
              and(
                eq(projectDocuments.projectId, projectId),
                inArray(projectDocuments.sourceDriveFileId, sourceIdChunk)
              )
            )
        )
      )
    ).flat()
    const duplicateIds = new Set(
      duplicateRows.map((row) => row.sourceDriveFileId)
    )
    const now = new Date().toISOString()
    const description = cleanText(input.description)
    const documentDate = cleanDate(input.documentDate)
    const revision = cleanText(input.revision)
    const rows = collected.files.flatMap((file) => {
      if (duplicateIds.has(file.id)) return []
      return [{
        id: crypto.randomUUID(),
        projectId,
        category,
        title: projectDocumentTitleFromFileName(file.name),
        description,
        documentDate,
        revision,
        status: "current",
        audience: "project_team",
        downloadable: true,
        sourceDriveFileId: file.id,
        sourceFileName: file.name,
        sourceMimeType: file.mimeType,
        sourceUrl: file.webViewLink ?? null,
        sourceChecksum: null,
        supersedesDocumentId: null,
        publishedBy: user.id,
        publishedAt: now,
        archivedAt: null,
        createdBy: user.id,
        createdAt: now,
        updatedAt: now,
      }]
    })
    if (rows.length > 0) {
      // A project-document row binds 21 columns. Four rows per statement keep
      // each insert below D1's 100-bound-parameter limit; batch is atomic.
      const firstInsert = db.insert(projectDocuments).values(rows.slice(0, 4))
      const remainingInserts = []
      for (let index = 4; index < rows.length; index += 4) {
        remainingInserts.push(
          db.insert(projectDocuments).values(rows.slice(index, index + 4))
        )
      }
      await db.batch([firstInsert, ...remainingInserts])
      await recordActivityEvent({
        db,
        organizationId: access.organizationId,
        projectId,
        actor: user,
        category: "file",
        action: "project_document.folder_published",
        entityType: "project_document_folder",
        entityId: sourceDriveFolderId,
        summary: `Published ${rows.length} documents from ${sourceFolder.name} to the entire project team.`,
        metadata: {
          category,
          folderName: sourceFolder.name,
          publishedCount: rows.length,
          skippedCount: duplicateIds.size + collected.unsupportedCount,
        },
      })
      refreshDocumentPaths(projectId)
    }
    return {
      success: true,
      publishedCount: rows.length,
      skippedCount: duplicateIds.size + collected.unsupportedCount,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to publish that folder.",
    }
  }
}
