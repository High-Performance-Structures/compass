"use server"

import { revalidatePath } from "next/cache"

import { actionFailure, errorMessage } from "@/lib/action-result"
import { createDriveUploadSession, openDriveSession } from "@/lib/domain/documents/drive-session"
import { readStarredFileIds, toggleStarredFile } from "@/lib/domain/documents/drive-connection-store"
import type { FileItem } from "@/lib/files-data"
import {
  listProjectDriveFolders,
  listProjectSourceFileItems,
  mergePinnedProjectSources,
} from "@/lib/google/drive-listings"
import { mapDriveFileToFileItem } from "@/lib/google/mapper"
import { requirePermission } from "@/lib/permissions"
import { withProjectCategoryMetadata } from "@/lib/project-files"
import { requireUserContext } from "@/lib/server/action-context"

/*
 * The Files page (src/hooks/use-files.tsx): browse, search and change files
 * in the organization's Google Drive as the signed-in person. Each action
 * starts with `openDriveSession` (src/lib/domain/documents/drive-session.ts),
 * which checks sign-in and permission and returns the Drive client.
 * Connecting Drive lives in google-drive.ts; Field Mode's read-only project
 * listings in google-drive-field.ts.
 */

type FileListResult =
  | { success: true; files: FileItem[]; nextPageToken: string | null }
  | { success: false; error: string }

type DoneResult = { success: true } | { success: false; error: string }

/** A folder's contents; with no folder, the shared drive (or My Drive) root. */
export async function listDriveFiles(folderId?: string, pageToken?: string): Promise<FileListResult> {
  try {
    const opened = await openDriveSession("document", "read")
    if (!opened.success) return opened
    const { user, db, auth, client, googleEmail } = opened.session
    const starredIds = await readStarredFileIds(db, user.id)

    const result = await client.listFiles(googleEmail, {
      folderId: folderId ?? auth.sharedDriveId ?? "root",
      driveId: auth.sharedDriveId ?? undefined,
      pageToken,
      orderBy: "folder,name",
    })

    let files = result.files.map(f =>
      withProjectCategoryMetadata(mapDriveFileToFileItem(f, starredIds, folderId ?? null))
    )

    // The first page of the root also shows the project roots at the top.
    if (!folderId && !pageToken) {
      const projectSources = await listProjectSourceFileItems(client, googleEmail, starredIds)
      files = mergePinnedProjectSources(files, projectSources)
    }

    return { success: true, files, nextPageToken: result.nextPageToken ?? null }
  } catch (err) {
    return actionFailure(errorMessage(err, "Failed to list files"))
  }
}

/** The left-hand views: "projects", "shared", "recent", "starred", "trash". */
export async function listDriveFilesForView(view: string, pageToken?: string): Promise<FileListResult> {
  try {
    const opened = await openDriveSession("document", "read")
    if (!opened.success) return opened
    const { user, db, auth, client, googleEmail } = opened.session
    const starredIds = await readStarredFileIds(db, user.id)
    const driveId = auth.sharedDriveId ?? undefined

    let result

    switch (view) {
      case "projects":
        return {
          success: true,
          files: await listProjectDriveFolders(client, googleEmail, starredIds),
          nextPageToken: null,
        }

      case "shared":
        result = await client.listFiles(googleEmail, { sharedWithMe: true, driveId, pageToken })
        break

      case "recent": {
        const thirtyDaysAgo = new Date()
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
        result = await client.listFiles(googleEmail, {
          query: `modifiedTime > '${thirtyDaysAgo.toISOString()}'`,
          orderBy: "modifiedTime desc",
          driveId,
          pageToken,
        })
        break
      }

      case "starred": {
        // Stars are kept in Compass, so each starred file is fetched by id.
        const files: FileItem[] = []
        for (const fileId of starredIds) {
          try {
            const file = await client.getFile(googleEmail, fileId)
            files.push(mapDriveFileToFileItem(file, starredIds, null))
          } catch {
            // file may have been deleted
          }
        }
        return { success: true, files, nextPageToken: null }
      }

      case "trash":
        result = await client.listFiles(googleEmail, { trashed: true, driveId, pageToken })
        break

      default:
        return actionFailure(`Unknown view: ${view}`)
    }

    let files = result.files.map(f => withProjectCategoryMetadata(mapDriveFileToFileItem(f, starredIds, null)))

    if (view === "shared" && !pageToken) {
      const projectSources = await listProjectSourceFileItems(client, googleEmail, starredIds)
      files = mergePinnedProjectSources(files, projectSources)
    }

    return { success: true, files, nextPageToken: result.nextPageToken ?? null }
  } catch (err) {
    return actionFailure(errorMessage(err, "Failed to list files"))
  }
}

export async function searchDriveFiles(
  query: string
): Promise<{ success: true; files: FileItem[] } | { success: false; error: string }> {
  try {
    const opened = await openDriveSession("document", "read")
    if (!opened.success) return opened
    const { user, db, auth, client, googleEmail } = opened.session
    const starredIds = await readStarredFileIds(db, user.id)

    const result = await client.searchFiles(googleEmail, query, 50, auth.sharedDriveId ?? undefined)

    return { success: true, files: result.files.map(f => mapDriveFileToFileItem(f, starredIds, null)) }
  } catch (err) {
    return actionFailure(errorMessage(err, "Search failed"))
  }
}

export async function getDriveFileInfo(
  fileId: string
): Promise<{ success: true; file: FileItem } | { success: false; error: string }> {
  try {
    const opened = await openDriveSession("document", "read")
    if (!opened.success) return opened
    const { user, db, client, googleEmail } = opened.session
    const starredIds = await readStarredFileIds(db, user.id)
    const driveFile = await client.getFile(googleEmail, fileId)

    return { success: true, file: mapDriveFileToFileItem(driveFile, starredIds, null) }
  } catch (err) {
    return actionFailure(errorMessage(err, "Failed to get file"))
  }
}

/** Folders only, for the "Move to" folder picker. */
export async function listDriveFolders(
  parentId?: string
): Promise<
  | { success: true; folders: ReadonlyArray<{ id: string; name: string }> }
  | { success: false; error: string }
> {
  try {
    const opened = await openDriveSession("document", "read")
    if (!opened.success) return opened
    const { auth, client, googleEmail } = opened.session

    const result = await client.listFiles(googleEmail, {
      folderId: parentId ?? auth.sharedDriveId ?? "root",
      query: "mimeType = 'application/vnd.google-apps.folder'",
      driveId: auth.sharedDriveId ?? undefined,
      pageSize: 200,
      orderBy: "name",
    })

    return { success: true, folders: result.files.map(f => ({ id: f.id, name: f.name })) }
  } catch (err) {
    return actionFailure(errorMessage(err, "Failed to list folders"))
  }
}

export async function getDriveStorageQuota(): Promise<
  { success: true; used: number; total: number } | { success: false; error: string }
> {
  try {
    const opened = await openDriveSession("document", "read")
    if (!opened.success) return opened
    const { client, googleEmail } = opened.session
    const about = await client.getStorageQuota(googleEmail)

    return {
      success: true,
      used: Number(about.storageQuota.usage),
      // Workspace pooled storage has no per-user limit; 0 means "unlimited".
      total: about.storageQuota.limit ? Number(about.storageQuota.limit) : 0,
    }
  } catch (err) {
    return actionFailure(errorMessage(err, "Failed to get quota"))
  }
}

export async function createDriveFolder(
  name: string,
  parentId?: string
): Promise<{ success: true; folder: FileItem } | { success: false; error: string }> {
  try {
    const opened = await openDriveSession("document", "create")
    if (!opened.success) return opened
    const { user, db, auth, client, googleEmail } = opened.session

    const driveFile = await client.createFolder(googleEmail, {
      name,
      parentId: parentId ?? auth.sharedDriveId ?? undefined,
      driveId: auth.sharedDriveId ?? undefined,
    })

    const starredIds = await readStarredFileIds(db, user.id)
    const folder = mapDriveFileToFileItem(driveFile, starredIds, parentId ?? null)

    revalidatePath("/dashboard/files")
    return { success: true, folder }
  } catch (err) {
    return actionFailure(errorMessage(err, "Failed to create folder"))
  }
}

export async function renameDriveFile(fileId: string, newName: string): Promise<DoneResult> {
  try {
    const opened = await openDriveSession("document", "update")
    if (!opened.success) return opened
    const { client, googleEmail } = opened.session
    await client.renameFile(googleEmail, fileId, newName)

    revalidatePath("/dashboard/files")
    return { success: true }
  } catch (err) {
    return actionFailure(errorMessage(err, "Failed to rename"))
  }
}

export async function moveDriveFile(fileId: string, newParentId: string, oldParentId: string): Promise<DoneResult> {
  try {
    const opened = await openDriveSession("document", "update")
    if (!opened.success) return opened
    const { client, googleEmail } = opened.session
    await client.moveFile(googleEmail, fileId, newParentId, oldParentId)

    revalidatePath("/dashboard/files")
    return { success: true }
  } catch (err) {
    return actionFailure(errorMessage(err, "Failed to move file"))
  }
}

/** Moves the file to Drive's trash (restorable), never a permanent delete. */
export async function trashDriveFile(fileId: string): Promise<DoneResult> {
  try {
    const opened = await openDriveSession("document", "delete")
    if (!opened.success) return opened
    const { client, googleEmail } = opened.session
    await client.trashFile(googleEmail, fileId)

    revalidatePath("/dashboard/files")
    return { success: true }
  } catch (err) {
    return actionFailure(errorMessage(err, "Failed to trash file"))
  }
}

export async function restoreDriveFile(fileId: string): Promise<DoneResult> {
  try {
    const opened = await openDriveSession("document", "update")
    if (!opened.success) return opened
    const { client, googleEmail } = opened.session
    await client.restoreFile(googleEmail, fileId)

    revalidatePath("/dashboard/files")
    return { success: true }
  } catch (err) {
    return actionFailure(errorMessage(err, "Failed to restore file"))
  }
}

export async function getUploadSessionUrl(
  fileName: string,
  mimeType: string,
  parentId?: string
): Promise<{ success: true; uploadUrl: string } | { success: false; error: string }> {
  return createDriveUploadSession(fileName, mimeType, parentId)
}

/** Stars are Compass's own (per person), not Google's. */
export async function toggleStarFile(
  googleFileId: string
): Promise<{ success: true; starred: boolean } | { success: false; error: string }> {
  try {
    const { user, db } = await requireUserContext()
    requirePermission(user, "document", "read")
    const starred = await toggleStarredFile(db, user.id, googleFileId)
    return { success: true, starred }
  } catch (err) {
    return actionFailure(errorMessage(err, "Failed to toggle star"))
  }
}
