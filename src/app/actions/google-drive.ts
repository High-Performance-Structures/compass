"use server"

import { getCloudflareContext } from "@opennextjs/cloudflare"
import { eq, and } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { getDb } from "@/db"
import { users } from "@/db/schema"
import { googleAuth, googleStarredFiles } from "@/db/schema-google"
import { getCurrentUser, requireAuth } from "@/lib/auth"
import type { AuthUser } from "@/lib/auth"
import { requirePermission } from "@/lib/permissions"
import { encrypt, decrypt } from "@/lib/crypto"
import {
  getGoogleConfig,
  getGoogleCryptoSalt,
  parseServiceAccountKey,
  type ServiceAccountKey,
} from "@/lib/google/config"
import { DriveClient } from "@/lib/google/client/drive-client"
import { mapDriveFileToFileItem } from "@/lib/google/mapper"
import type { FileItem } from "@/lib/files-data"

// helpers

function resolveGoogleEmail(user: AuthUser): string {
  return user.googleEmail ?? user.email
}

async function getOrgGoogleAuth(db: ReturnType<typeof getDb>) {
  const rows = await db.select().from(googleAuth).limit(1)
  return rows[0] ?? null
}

async function getDecryptedServiceAccountKey(
  encryptedKey: string,
  encryptionKey: string
): Promise<ServiceAccountKey> {
  const json = await decrypt(
    encryptedKey,
    encryptionKey,
    getGoogleCryptoSalt()
  )
  return parseServiceAccountKey(json)
}

async function buildDriveClient(
  encryptedKey: string,
  encryptionKey: string
): Promise<DriveClient> {
  const serviceAccountKey = await getDecryptedServiceAccountKey(
    encryptedKey,
    encryptionKey
  )
  return new DriveClient({ serviceAccountKey })
}

async function getStarredIds(
  db: ReturnType<typeof getDb>,
  userId: string
): Promise<ReadonlySet<string>> {
  const rows = await db
    .select({ googleFileId: googleStarredFiles.googleFileId })
    .from(googleStarredFiles)
    .where(eq(googleStarredFiles.userId, userId))
  return new Set(rows.map(r => r.googleFileId))
}

// connection management

export async function getGoogleDriveConnectionStatus(): Promise<{
  connected: boolean
  workspaceDomain: string | null
  sharedDriveName: string | null
}> {
  try {
    const user = await getCurrentUser() // keep nullable - graceful fallback
    requirePermission(user, "document", "read")
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const auth = await getOrgGoogleAuth(db)

    if (!auth) {
      return {
        connected: false,
        workspaceDomain: null,
        sharedDriveName: null,
      }
    }

    return {
      connected: true,
      workspaceDomain: auth.workspaceDomain,
      sharedDriveName: auth.sharedDriveName,
    }
  } catch {
    return {
      connected: false,
      workspaceDomain: null,
      sharedDriveName: null,
    }
  }
}

export async function connectGoogleDrive(
  serviceAccountKeyJson: string,
  workspaceDomain: string
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const user = await requireAuth()
    requirePermission(user, "organization", "update")

    const parsed = parseServiceAccountKey(serviceAccountKeyJson)

    const { env } = await getCloudflareContext()
    const envRecord = env as unknown as Record<string, string>
    const config = getGoogleConfig(envRecord)
    const db = getDb(env.DB)

    // validate by making a test call
    const client = new DriveClient({ serviceAccountKey: parsed })
    const testEmail = user.email
    try {
      await client.getStorageQuota(testEmail)
    } catch (testErr) {
      return {
        success: false,
        error: `Failed to connect: ${testErr instanceof Error ? testErr.message : "Unknown error"}. Check domain-wide delegation.`,
      }
    }

    const encryptedKey = await encrypt(
      serviceAccountKeyJson,
      config.encryptionKey,
      getGoogleCryptoSalt()
    )

    // upsert: delete existing then insert
    await db.delete(googleAuth).run()
    await db
      .insert(googleAuth)
      .values({
        id: crypto.randomUUID(),
        organizationId: "default",
        serviceAccountKeyEncrypted: encryptedKey,
        workspaceDomain,
        connectedBy: user.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .run()

    revalidatePath("/dashboard/files")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error
        ? err.message
        : "Failed to connect Google Drive",
    }
  }
}

export async function disconnectGoogleDrive(): Promise<
  { success: true } | { success: false; error: string }
> {
  try {
    const user = await requireAuth()
    requirePermission(user, "organization", "delete")
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    await db.delete(googleAuth).run()
    revalidatePath("/dashboard/files")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error
        ? err.message
        : "Failed to disconnect",
    }
  }
}

export async function listAvailableSharedDrives(): Promise<
  | {
      success: true
      drives: ReadonlyArray<{ id: string; name: string }>
    }
  | { success: false; error: string }
> {
  try {
    const user = await requireAuth()
    requirePermission(user, "organization", "update")

    const { env } = await getCloudflareContext()
    const envRecord = env as unknown as Record<string, string>
    const config = getGoogleConfig(envRecord)
    const db = getDb(env.DB)
    const auth = await getOrgGoogleAuth(db)
    if (!auth) {
      return { success: false, error: "Google Drive not connected" }
    }

    const googleEmail = resolveGoogleEmail(user)
    if (!googleEmail) {
      return { success: false, error: "No Google email" }
    }

    const client = await buildDriveClient(
      auth.serviceAccountKeyEncrypted,
      config.encryptionKey
    )
    const result = await client.listSharedDrives(googleEmail)

    return {
      success: true,
      drives: result.drives.map(d => ({
        id: d.id,
        name: d.name,
      })),
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed",
    }
  }
}

export async function selectSharedDrive(
  driveId: string | null,
  driveName: string | null
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const user = await requireAuth()
    requirePermission(user, "organization", "update")

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const auth = await getOrgGoogleAuth(db)
    if (!auth) {
      return { success: false, error: "Google Drive not connected" }
    }

    await db
      .update(googleAuth)
      .set({
        sharedDriveId: driveId,
        sharedDriveName: driveName,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(googleAuth.id, auth.id))
      .run()

    revalidatePath("/dashboard/files")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed",
    }
  }
}

// file operations

export async function listDriveFiles(
  folderId?: string,
  pageToken?: string
): Promise<
  | {
      success: true
      files: FileItem[]
      nextPageToken: string | null
    }
  | { success: false; error: string }
> {
  try {
    const user = await requireAuth()
    requirePermission(user, "document", "read")

    const googleEmail = resolveGoogleEmail(user)
    if (!googleEmail) {
      return { success: false, error: "No Google account linked" }
    }

    const { env } = await getCloudflareContext()
    const envRecord = env as unknown as Record<string, string>
    const config = getGoogleConfig(envRecord)
    const db = getDb(env.DB)
    const auth = await getOrgGoogleAuth(db)
    if (!auth) {
      return { success: false, error: "Google Drive not connected" }
    }

    const client = await buildDriveClient(
      auth.serviceAccountKeyEncrypted,
      config.encryptionKey
    )
    const starredIds = await getStarredIds(db, user.id)

    const targetFolder =
      folderId ?? auth.sharedDriveId ?? undefined
    const result = await client.listFiles(googleEmail, {
      folderId: targetFolder,
      driveId: auth.sharedDriveId ?? undefined,
      pageToken,
      orderBy: "folder,name",
    })

    const files = result.files.map(f =>
      mapDriveFileToFileItem(f, starredIds, folderId ?? null)
    )

    return {
      success: true,
      files,
      nextPageToken: result.nextPageToken ?? null,
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to list files",
    }
  }
}

export async function listDriveFilesForView(
  view: string,
  pageToken?: string
): Promise<
  | {
      success: true
      files: FileItem[]
      nextPageToken: string | null
    }
  | { success: false; error: string }
> {
  try {
    const user = await requireAuth()
    requirePermission(user, "document", "read")

    const googleEmail = resolveGoogleEmail(user)
    if (!googleEmail) {
      return { success: false, error: "No Google account linked" }
    }

    const { env } = await getCloudflareContext()
    const envRecord = env as unknown as Record<string, string>
    const config = getGoogleConfig(envRecord)
    const db = getDb(env.DB)
    const auth = await getOrgGoogleAuth(db)
    if (!auth) {
      return { success: false, error: "Google Drive not connected" }
    }

    const client = await buildDriveClient(
      auth.serviceAccountKeyEncrypted,
      config.encryptionKey
    )
    const starredIds = await getStarredIds(db, user.id)

    let result

    switch (view) {
      case "shared":
        result = await client.listFiles(googleEmail, {
          sharedWithMe: true,
          driveId: auth.sharedDriveId ?? undefined,
          pageToken,
        })
        break

      case "recent": {
        const thirtyDaysAgo = new Date()
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
        result = await client.listFiles(googleEmail, {
          query: `modifiedTime > '${thirtyDaysAgo.toISOString()}'`,
          orderBy: "modifiedTime desc",
          driveId: auth.sharedDriveId ?? undefined,
          pageToken,
        })
        break
      }

      case "starred": {
        if (starredIds.size === 0) {
          return {
            success: true,
            files: [],
            nextPageToken: null,
          }
        }
        const fileIds = [...starredIds]
        const files: FileItem[] = []
        for (const fileId of fileIds) {
          try {
            const file = await client.getFile(
              googleEmail,
              fileId
            )
            files.push(
              mapDriveFileToFileItem(file, starredIds, null)
            )
          } catch {
            // file may have been deleted
          }
        }
        return { success: true, files, nextPageToken: null }
      }

      case "trash":
        result = await client.listFiles(googleEmail, {
          trashed: true,
          driveId: auth.sharedDriveId ?? undefined,
          pageToken,
        })
        break

      default:
        return { success: false, error: `Unknown view: ${view}` }
    }

    const files = result.files.map(f =>
      mapDriveFileToFileItem(f, starredIds, null)
    )

    return {
      success: true,
      files,
      nextPageToken: result.nextPageToken ?? null,
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to list files",
    }
  }
}

export async function searchDriveFiles(
  query: string
): Promise<
  | { success: true; files: FileItem[] }
  | { success: false; error: string }
> {
  try {
    const user = await requireAuth()
    requirePermission(user, "document", "read")

    const googleEmail = resolveGoogleEmail(user)
    if (!googleEmail) {
      return { success: false, error: "No Google account linked" }
    }

    const { env } = await getCloudflareContext()
    const envRecord = env as unknown as Record<string, string>
    const config = getGoogleConfig(envRecord)
    const db = getDb(env.DB)
    const auth = await getOrgGoogleAuth(db)
    if (!auth) {
      return { success: false, error: "Google Drive not connected" }
    }

    const client = await buildDriveClient(
      auth.serviceAccountKeyEncrypted,
      config.encryptionKey
    )
    const starredIds = await getStarredIds(db, user.id)

    const result = await client.searchFiles(
      googleEmail,
      query,
      50,
      auth.sharedDriveId ?? undefined
    )

    const files = result.files.map(f =>
      mapDriveFileToFileItem(f, starredIds, null)
    )

    return { success: true, files }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error
        ? err.message
        : "Search failed",
    }
  }
}

export async function createDriveFolder(
  name: string,
  parentId?: string
): Promise<
  | { success: true; folder: FileItem }
  | { success: false; error: string }
> {
  try {
    const user = await requireAuth()
    requirePermission(user, "document", "create")

    const googleEmail = resolveGoogleEmail(user)
    if (!googleEmail) {
      return { success: false, error: "No Google account linked" }
    }

    const { env } = await getCloudflareContext()
    const envRecord = env as unknown as Record<string, string>
    const config = getGoogleConfig(envRecord)
    const db = getDb(env.DB)
    const auth = await getOrgGoogleAuth(db)
    if (!auth) {
      return { success: false, error: "Google Drive not connected" }
    }

    const client = await buildDriveClient(
      auth.serviceAccountKeyEncrypted,
      config.encryptionKey
    )

    const driveFile = await client.createFolder(googleEmail, {
      name,
      parentId: parentId ?? auth.sharedDriveId ?? undefined,
      driveId: auth.sharedDriveId ?? undefined,
    })

    const starredIds = await getStarredIds(db, user.id)
    const folder = mapDriveFileToFileItem(
      driveFile,
      starredIds,
      parentId ?? null
    )

    revalidatePath("/dashboard/files")
    return { success: true, folder }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error
        ? err.message
        : "Failed to create folder",
    }
  }
}

export async function renameDriveFile(
  fileId: string,
  newName: string
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const user = await requireAuth()
    requirePermission(user, "document", "update")

    const googleEmail = resolveGoogleEmail(user)
    if (!googleEmail) {
      return { success: false, error: "No Google account linked" }
    }

    const { env } = await getCloudflareContext()
    const envRecord = env as unknown as Record<string, string>
    const config = getGoogleConfig(envRecord)
    const db = getDb(env.DB)
    const auth = await getOrgGoogleAuth(db)
    if (!auth) {
      return { success: false, error: "Google Drive not connected" }
    }

    const client = await buildDriveClient(
      auth.serviceAccountKeyEncrypted,
      config.encryptionKey
    )
    await client.renameFile(googleEmail, fileId, newName)

    revalidatePath("/dashboard/files")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error
        ? err.message
        : "Failed to rename",
    }
  }
}

export async function moveDriveFile(
  fileId: string,
  newParentId: string,
  oldParentId: string
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const user = await requireAuth()
    requirePermission(user, "document", "update")

    const googleEmail = resolveGoogleEmail(user)
    if (!googleEmail) {
      return { success: false, error: "No Google account linked" }
    }

    const { env } = await getCloudflareContext()
    const envRecord = env as unknown as Record<string, string>
    const config = getGoogleConfig(envRecord)
    const db = getDb(env.DB)
    const auth = await getOrgGoogleAuth(db)
    if (!auth) {
      return { success: false, error: "Google Drive not connected" }
    }

    const client = await buildDriveClient(
      auth.serviceAccountKeyEncrypted,
      config.encryptionKey
    )
    await client.moveFile(
      googleEmail,
      fileId,
      newParentId,
      oldParentId
    )

    revalidatePath("/dashboard/files")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error
        ? err.message
        : "Failed to move file",
    }
  }
}

export async function trashDriveFile(
  fileId: string
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const user = await requireAuth()
    requirePermission(user, "document", "delete")

    const googleEmail = resolveGoogleEmail(user)
    if (!googleEmail) {
      return { success: false, error: "No Google account linked" }
    }

    const { env } = await getCloudflareContext()
    const envRecord = env as unknown as Record<string, string>
    const config = getGoogleConfig(envRecord)
    const db = getDb(env.DB)
    const auth = await getOrgGoogleAuth(db)
    if (!auth) {
      return { success: false, error: "Google Drive not connected" }
    }

    const client = await buildDriveClient(
      auth.serviceAccountKeyEncrypted,
      config.encryptionKey
    )
    await client.trashFile(googleEmail, fileId)

    revalidatePath("/dashboard/files")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error
        ? err.message
        : "Failed to trash file",
    }
  }
}

export async function restoreDriveFile(
  fileId: string
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const user = await requireAuth()
    requirePermission(user, "document", "update")

    const googleEmail = resolveGoogleEmail(user)
    if (!googleEmail) {
      return { success: false, error: "No Google account linked" }
    }

    const { env } = await getCloudflareContext()
    const envRecord = env as unknown as Record<string, string>
    const config = getGoogleConfig(envRecord)
    const db = getDb(env.DB)
    const auth = await getOrgGoogleAuth(db)
    if (!auth) {
      return { success: false, error: "Google Drive not connected" }
    }

    const client = await buildDriveClient(
      auth.serviceAccountKeyEncrypted,
      config.encryptionKey
    )
    await client.restoreFile(googleEmail, fileId)

    revalidatePath("/dashboard/files")
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error
        ? err.message
        : "Failed to restore file",
    }
  }
}

export async function getDriveStorageQuota(): Promise<
  | { success: true; used: number; total: number }
  | { success: false; error: string }
> {
  try {
    const user = await requireAuth()
    requirePermission(user, "document", "read")

    const googleEmail = resolveGoogleEmail(user)
    if (!googleEmail) {
      return { success: false, error: "No Google account linked" }
    }

    const { env } = await getCloudflareContext()
    const envRecord = env as unknown as Record<string, string>
    const config = getGoogleConfig(envRecord)
    const db = getDb(env.DB)
    const auth = await getOrgGoogleAuth(db)
    if (!auth) {
      return { success: false, error: "Google Drive not connected" }
    }

    const client = await buildDriveClient(
      auth.serviceAccountKeyEncrypted,
      config.encryptionKey
    )
    const about = await client.getStorageQuota(googleEmail)

    return {
      success: true,
      used: Number(about.storageQuota.usage),
      total: about.storageQuota.limit
        ? Number(about.storageQuota.limit)
        : 0,
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error
        ? err.message
        : "Failed to get quota",
    }
  }
}

export async function getUploadSessionUrl(
  fileName: string,
  mimeType: string,
  parentId?: string
): Promise<
  | { success: true; uploadUrl: string }
  | { success: false; error: string }
> {
  try {
    const user = await requireAuth()
    requirePermission(user, "document", "create")

    const googleEmail = resolveGoogleEmail(user)
    if (!googleEmail) {
      return { success: false, error: "No Google account linked" }
    }

    const { env } = await getCloudflareContext()
    const envRecord = env as unknown as Record<string, string>
    const config = getGoogleConfig(envRecord)
    const db = getDb(env.DB)
    const auth = await getOrgGoogleAuth(db)
    if (!auth) {
      return { success: false, error: "Google Drive not connected" }
    }

    const client = await buildDriveClient(
      auth.serviceAccountKeyEncrypted,
      config.encryptionKey
    )

    const uploadUrl = await client.initiateResumableUpload(
      googleEmail,
      {
        name: fileName,
        mimeType,
        parentId: parentId ?? auth.sharedDriveId ?? undefined,
        driveId: auth.sharedDriveId ?? undefined,
      }
    )

    return { success: true, uploadUrl }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error
        ? err.message
        : "Failed to initiate upload",
    }
  }
}

export async function toggleStarFile(
  googleFileId: string
): Promise<
  | { success: true; starred: boolean }
  | { success: false; error: string }
> {
  try {
    const user = await requireAuth()
    requirePermission(user, "document", "read")

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const existing = await db
      .select()
      .from(googleStarredFiles)
      .where(
        and(
          eq(googleStarredFiles.userId, user.id),
          eq(googleStarredFiles.googleFileId, googleFileId)
        )
      )
      .get()

    if (existing) {
      await db
        .delete(googleStarredFiles)
        .where(eq(googleStarredFiles.id, existing.id))
        .run()
      return { success: true, starred: false }
    }

    await db
      .insert(googleStarredFiles)
      .values({
        id: crypto.randomUUID(),
        userId: user.id,
        googleFileId,
        createdAt: new Date().toISOString(),
      })
      .run()
    return { success: true, starred: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error
        ? err.message
        : "Failed to toggle star",
    }
  }
}

export async function getStarredFileIds(): Promise<
  | { success: true; fileIds: string[] }
  | { success: false; error: string }
> {
  try {
    const user = await requireAuth()
    requirePermission(user, "document", "read")

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    const rows = await db
      .select({ googleFileId: googleStarredFiles.googleFileId })
      .from(googleStarredFiles)
      .where(eq(googleStarredFiles.userId, user.id))

    return {
      success: true,
      fileIds: rows.map(r => r.googleFileId),
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error
        ? err.message
        : "Failed to get starred files",
    }
  }
}

export async function updateUserGoogleEmail(
  userId: string,
  googleEmail: string | null
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const user = await requireAuth()
    requirePermission(user, "user", "update")

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    await db
      .update(users)
      .set({
        googleEmail,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.id, userId))
      .run()

    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error
        ? err.message
        : "Failed to update email",
    }
  }
}

export async function getDriveFileInfo(
  fileId: string
): Promise<
  | { success: true; file: FileItem }
  | { success: false; error: string }
> {
  try {
    const user = await requireAuth()
    requirePermission(user, "document", "read")

    const googleEmail = resolveGoogleEmail(user)
    if (!googleEmail) {
      return { success: false, error: "No Google account linked" }
    }

    const { env } = await getCloudflareContext()
    const envRecord = env as unknown as Record<string, string>
    const config = getGoogleConfig(envRecord)
    const db = getDb(env.DB)
    const auth = await getOrgGoogleAuth(db)
    if (!auth) {
      return { success: false, error: "Google Drive not connected" }
    }

    const client = await buildDriveClient(
      auth.serviceAccountKeyEncrypted,
      config.encryptionKey
    )
    const starredIds = await getStarredIds(db, user.id)
    const driveFile = await client.getFile(
      googleEmail,
      fileId
    )

    return {
      success: true,
      file: mapDriveFileToFileItem(driveFile, starredIds, null),
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error
        ? err.message
        : "Failed to get file",
    }
  }
}

export async function listDriveFolders(
  parentId?: string
): Promise<
  | {
      success: true
      folders: ReadonlyArray<{ id: string; name: string }>
    }
  | { success: false; error: string }
> {
  try {
    const user = await requireAuth()
    requirePermission(user, "document", "read")

    const googleEmail = resolveGoogleEmail(user)
    if (!googleEmail) {
      return { success: false, error: "No Google account linked" }
    }

    const { env } = await getCloudflareContext()
    const envRecord = env as unknown as Record<string, string>
    const config = getGoogleConfig(envRecord)
    const db = getDb(env.DB)
    const auth = await getOrgGoogleAuth(db)
    if (!auth) {
      return { success: false, error: "Google Drive not connected" }
    }

    const client = await buildDriveClient(
      auth.serviceAccountKeyEncrypted,
      config.encryptionKey
    )

    const targetFolder =
      parentId ?? auth.sharedDriveId ?? undefined
    const result = await client.listFiles(googleEmail, {
      folderId: targetFolder,
      query:
        "mimeType = 'application/vnd.google-apps.folder'",
      driveId: auth.sharedDriveId ?? undefined,
      pageSize: 200,
      orderBy: "name",
    })

    return {
      success: true,
      folders: result.files.map(f => ({
        id: f.id,
        name: f.name,
      })),
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error
        ? err.message
        : "Failed to list folders",
    }
  }
}
