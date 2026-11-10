"use server"

import { eq } from "drizzle-orm"

import { projects } from "@/db/schema"
import { actionFailure, errorMessage, type ActionFailure } from "@/lib/action-result"
import type { AuthUser } from "@/lib/auth"
import { isDemoUser } from "@/lib/demo"
import { readConnectionOwnerGoogleEmail, readStarredFileIds } from "@/lib/domain/documents/drive-connection-store"
import { buildDriveClient, getOrgGoogleAuth, type OrgGoogleAuth } from "@/lib/domain/documents/drive-session"
import { filterFieldDocumentRootFolders } from "@/lib/field/document-access"
import { assertFieldProjectMembership } from "@/lib/field/project-access"
import type { FileItem } from "@/lib/files-data"
import type { DriveClient } from "@/lib/google/client/drive-client"
import { getGoogleConfig } from "@/lib/google/config"
import { mapDriveFileToFileItem } from "@/lib/google/mapper"
import { isDriveItemWithinProjectFolder } from "@/lib/google/project-folder-boundary"
import { requirePermission } from "@/lib/permissions"
import { withProjectCategoryMetadata } from "@/lib/project-files"
import { requireUserContext, type Db } from "@/lib/server/action-context"

/*
 * Field Mode's read-only project documents (called from field-mode.ts).
 * Crew members are usually not Workspace users, so Drive is read as the
 * person who connected Drive, and only the job folder's field document
 * folders (src/lib/field/document-access.ts) are shown.
 */

type FieldDrive = {
  readonly user: AuthUser
  readonly db: Db
  readonly auth: OrgGoogleAuth
  readonly client: DriveClient
  /** The Drive connection owner's identity, not the crew member's. */
  readonly googleEmail: string
  readonly projectFolderId: string
}

/**
 * Signed-in project member with document read, the job's Drive folder, and a
 * client reading as the Drive connection owner. Returns null for the demo
 * account, which sees an empty folder.
 */
async function openFieldProjectDrive(projectId: string): Promise<FieldDrive | ActionFailure | null> {
  const { user, db, env } = await requireUserContext()
  requirePermission(user, "document", "read")
  if (isDemoUser(user.id)) return null

  await assertFieldProjectMembership(db, user.id, projectId)

  const project = await db
    .select({ folderId: projects.googleDriveFolderId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get()
  if (!project?.folderId) return actionFailure("Project folder is not mapped")

  const auth = await getOrgGoogleAuth(db)
  if (!auth) return actionFailure("Google Drive not connected")

  const googleEmail = await readConnectionOwnerGoogleEmail(db, auth.connectedBy)
  if (!googleEmail) return actionFailure("Google Drive connection owner not found")

  const client = await buildDriveClient(auth.serviceAccountKeyEncrypted, getGoogleConfig(env).encryptionKey)
  return { user, db, auth, client, googleEmail, projectFolderId: project.folderId }
}

/** The job folder's field document folders (its top level, filtered). */
export async function listProjectDriveFilesForField(
  projectId: string
): Promise<
  | { success: true; files: FileItem[]; nextPageToken: string | null }
  | { success: false; error: string }
> {
  try {
    const drive = await openFieldProjectDrive(projectId)
    if (drive === null) return { success: true, files: [], nextPageToken: null }
    if ("success" in drive) return drive
    const { user, db, auth, client, googleEmail, projectFolderId } = drive

    const starredIds = await readStarredFileIds(db, user.id)
    const result = await client.listFiles(googleEmail, {
      folderId: projectFolderId,
      driveId: auth.sharedDriveId ?? undefined,
      orderBy: "folder,name",
    })

    return {
      success: true,
      files: filterFieldDocumentRootFolders(result.files).map(file =>
        withProjectCategoryMetadata(mapDriveFileToFileItem(file, starredIds, projectFolderId))
      ),
      nextPageToken: result.nextPageToken ?? null,
    }
  } catch (err) {
    return actionFailure(errorMessage(err, "Failed to list project files"))
  }
}

/** One folder inside the field document folders; anything outside is refused. */
export async function listProjectDriveFolderForField(
  projectId: string,
  folderId: string
): Promise<
  | { success: true; folderName: string; files: FileItem[]; nextPageToken: string | null }
  | { success: false; error: string }
> {
  try {
    const drive = await openFieldProjectDrive(projectId)
    if (drive === null) return { success: true, folderName: "Documents", files: [], nextPageToken: null }
    if ("success" in drive) return drive
    const { user, db, auth, client, googleEmail, projectFolderId } = drive

    const projectRoot = await client.listFiles(googleEmail, {
      folderId: projectFolderId,
      driveId: auth.sharedDriveId ?? undefined,
      orderBy: "folder,name",
    })
    let withinFieldDocuments = false
    for (const root of filterFieldDocumentRootFolders(projectRoot.files)) {
      if (await isDriveItemWithinProjectFolder({ client, googleEmail, itemId: folderId, projectFolderId: root.id })) {
        withinFieldDocuments = true
        break
      }
    }
    if (!withinFieldDocuments) {
      return actionFailure("Folder is outside the documents available in Field Mode")
    }

    const [folder, starredIds, result] = await Promise.all([
      client.getFile(googleEmail, folderId),
      readStarredFileIds(db, user.id),
      client.listFiles(googleEmail, {
        folderId,
        driveId: auth.sharedDriveId ?? undefined,
        orderBy: "folder,name",
      }),
    ])

    if (folder.mimeType !== "application/vnd.google-apps.folder") {
      return actionFailure("The selected item is not a folder")
    }

    return {
      success: true,
      folderName: folder.name,
      files: result.files.map(file =>
        withProjectCategoryMetadata(mapDriveFileToFileItem(file, starredIds, folderId))
      ),
      nextPageToken: result.nextPageToken ?? null,
    }
  } catch (err) {
    return actionFailure(errorMessage(err, "Failed to list project folder"))
  }
}
