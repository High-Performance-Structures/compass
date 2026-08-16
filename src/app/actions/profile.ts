"use server"

import { getWorkOS, signOut } from "@workos-inc/authkit-nextjs"
import { getCloudflareContext } from "@/lib/db"
import { getDb } from "@/db"
import { organizationMembers, organizations, users } from "@/db/schema"
import { googleAuth } from "@/db/schema-google"
import { and, eq, exists } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { requireAuth } from "@/lib/auth"
import { decrypt } from "@/lib/crypto"
import { isDemoUser } from "@/lib/demo"
import { DriveClient } from "@/lib/google/client/drive-client"
import type { DriveFile } from "@/lib/google/client/types"
import {
  getGoogleConfig,
  getGoogleCryptoSalt,
  parseServiceAccountKey,
} from "@/lib/google/config"
import { requireOrg } from "@/lib/org-scope"
import { isInternalStaffRole } from "@/lib/user-roles"
import {
  controlledDeskPhotoUrl,
  HIDDEN_DESK_PHOTO,
  isDeskPhotoSlot,
  parseImageDataUrl,
  type DeskPhotoSlot,
} from "@/lib/user-photo-storage"
import {
  updateProfileSchema,
  changePasswordSchema,
  type UpdateProfileInput,
  type ChangePasswordInput,
} from "@/lib/validations/profile"

type ActionResult<T = undefined> =
  | { success: true; data?: T }
  | { success: false; error: string }

const WORKSPACE_PHOTO_FOLDER_NAME = "Compass Workspace Photos"
const MAX_WORKSPACE_PHOTO_BYTES = 500_000
const GOOGLE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"

type WorkspacePhotoData = {
  readonly url: string | null
}

async function requireWorkspacePhotoAccess(
  userId: string,
  organizationId: string,
  role: string
): Promise<void> {
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const membership = await db
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(
      and(
        eq(organizationMembers.userId, userId),
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.role, role),
        eq(users.isActive, true),
        eq(organizations.isActive, true),
        eq(organizations.type, "internal")
      )
    )
    .limit(1)
    .get()

  if (!membership) throw new Error("Workspace membership is required")
}

async function workspaceDrive(input: {
  readonly db: ReturnType<typeof getDb>
  readonly environment: unknown
  readonly organizationId: string
}): Promise<{
  readonly client: DriveClient
  readonly googleEmail: string
  readonly driveId: string | null
}> {
  const auth = await input.db
    .select({
      serviceAccountKeyEncrypted: googleAuth.serviceAccountKeyEncrypted,
      sharedDriveId: googleAuth.sharedDriveId,
      connectorGoogleEmail: users.googleEmail,
      connectorEmail: users.email,
    })
    .from(googleAuth)
    .innerJoin(users, eq(users.id, googleAuth.connectedBy))
    .innerJoin(organizations, eq(organizations.id, googleAuth.organizationId))
    .where(
      and(
        eq(googleAuth.organizationId, input.organizationId),
        eq(organizations.isActive, true),
        eq(organizations.type, "internal")
      )
    )
    .limit(1)
    .get()

  if (!auth) throw new Error("Google Workspace storage is not connected")
  const driveId = auth.sharedDriveId?.trim()
  if (!driveId) throw new Error("A Shared Drive is required for workspace photos")

  const config = getGoogleConfig(input.environment)
  const keyJson = await decrypt(
    auth.serviceAccountKeyEncrypted,
    config.encryptionKey,
    getGoogleCryptoSalt()
  )

  return {
    client: new DriveClient({
      serviceAccountKey: parseServiceAccountKey(keyJson),
    }),
    googleEmail: auth.connectorGoogleEmail ?? auth.connectorEmail,
    driveId,
  }
}

async function workspacePhotoFolder(input: {
  readonly client: DriveClient
  readonly googleEmail: string
  readonly driveId: string | null
}): Promise<string> {
  const parentId = input.driveId ?? "root"
  const existing = await input.client.listFiles(input.googleEmail, {
    folderId: parentId,
    driveId: input.driveId ?? undefined,
    pageSize: 10,
    query:
      `mimeType = '${GOOGLE_FOLDER_MIME_TYPE}' and ` +
      `name = '${WORKSPACE_PHOTO_FOLDER_NAME}'`,
  })
  const folder = existing.files[0]
  if (folder) return folder.id

  const created = await input.client.createFolder(input.googleEmail, {
    name: WORKSPACE_PHOTO_FOLDER_NAME,
    parentId,
    driveId: input.driveId ?? undefined,
  })
  return created.id
}

function workspacePhotoValue(
  value: string
): { readonly url: string | null; readonly data: ReturnType<typeof parseImageDataUrl> } {
  if (value === HIDDEN_DESK_PHOTO) return { url: HIDDEN_DESK_PHOTO, data: null }

  const data = parseImageDataUrl(value)
  if (!data || data.bytes.byteLength > MAX_WORKSPACE_PHOTO_BYTES) {
    throw new Error("Use a JPEG, PNG, or WebP image under 500 KB.")
  }
  return { url: null, data }
}

function isOwnedWorkspacePhoto(
  metadata: DriveFile,
  input: {
    readonly organizationId: string
    readonly userId: string
    readonly slot: DeskPhotoSlot
    readonly driveId: string | null
  }
): boolean {
  const properties = metadata.appProperties
  return (
    metadata.trashed !== true &&
    (metadata.mimeType === "image/jpeg" ||
      metadata.mimeType === "image/png" ||
      metadata.mimeType === "image/webp") &&
    (!input.driveId ? !metadata.driveId : metadata.driveId === input.driveId) &&
    properties?.compassResource === "workspace-desk-photo" &&
    properties.organizationId === input.organizationId &&
    properties.userId === input.userId &&
    properties.slot === input.slot
  )
}

export async function updateWorkspacePhoto(
  slot: DeskPhotoSlot,
  value: string
): Promise<ActionResult<WorkspacePhotoData>> {
  try {
    if (!isDeskPhotoSlot(slot)) {
      return { success: false, error: "Invalid desk-photo slot." }
    }
    const currentUser = await requireAuth()
    if (isDemoUser(currentUser.id) || !isInternalStaffRole(currentUser.role)) {
      return { success: false, error: "Desk photos are not available here." }
    }
    const organizationId = requireOrg(currentUser)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    await requireWorkspacePhotoAccess(currentUser.id, organizationId, currentUser.role)

    const photo = workspacePhotoValue(value.trim() || HIDDEN_DESK_PHOTO)
    const authorizedUser = exists(
      db
        .select({ id: organizationMembers.id })
        .from(organizationMembers)
        .innerJoin(
          organizations,
          eq(organizations.id, organizationMembers.organizationId)
        )
        .where(
          and(
            eq(organizationMembers.userId, currentUser.id),
            eq(organizationMembers.organizationId, organizationId),
            eq(organizationMembers.role, currentUser.role),
            eq(users.isActive, true),
            eq(organizations.isActive, true),
            eq(organizations.type, "internal")
          )
        )
    )
    let nextValue = photo.url
    let uploadedFileId: string | null = null
    let drive: Awaited<ReturnType<typeof workspaceDrive>> | null = null

    if (photo.data) {
      drive = await workspaceDrive({
        db,
        environment: env,
        organizationId,
      })
      const folderId = await workspacePhotoFolder(drive)
      const uploaded = await drive.client.uploadFile(drive.googleEmail, {
        name: `compass-${slot}-${crypto.randomUUID()}.${photo.data.mimeType.slice(6)}`,
        parentId: folderId,
        driveId: drive.driveId ?? undefined,
        mimeType: photo.data.mimeType,
        size: photo.data.bytes.byteLength,
        data: new Blob([photo.data.bytes], { type: photo.data.mimeType }),
        appProperties: {
          compassResource: "workspace-desk-photo",
          organizationId,
          userId: currentUser.id,
          slot,
        },
      })
      uploadedFileId = uploaded.id
      nextValue = controlledDeskPhotoUrl(slot, uploaded.id)
    }

    const photoOrganizationId = nextValue === null ? null : organizationId
    const discardUploadedPhoto = async (): Promise<void> => {
      if (!uploadedFileId || !drive) return
      try {
        const uploaded = await drive.client.getFile(
          drive.googleEmail,
          uploadedFileId
        )
        if (
          isOwnedWorkspacePhoto(uploaded, {
            organizationId,
            userId: currentUser.id,
            slot,
            driveId: drive.driveId,
          })
        ) {
          await drive.client.trashFile(drive.googleEmail, uploadedFileId)
        }
      } catch (cleanupError: unknown) {
        console.warn("Unable to trash an uncommitted workspace photo", cleanupError)
      }
    }

    const updateResult = await db
      .update(users)
      .set({
        ...(slot === "dashboard"
          ? {
              dashboardDeskPhotoUrl: nextValue,
              dashboardDeskPhotoOrganizationId: photoOrganizationId,
            }
          : {
              sidebarDeskPhotoUrl: nextValue,
              sidebarDeskPhotoOrganizationId: photoOrganizationId,
            }),
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(users.id, currentUser.id), authorizedUser))
      .run()
      .catch(async (error: unknown) => {
        await discardUploadedPhoto()
        throw error
      })

    if ((updateResult.meta.changes ?? 0) !== 1) {
      await discardUploadedPhoto()
      throw new Error("Workspace photo was not saved")
    }

    revalidatePath("/dashboard", "layout")
    return { success: true, data: { url: nextValue === HIDDEN_DESK_PHOTO ? null : nextValue } }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to update workspace photo",
    }
  }
}

/**
 * Update the current user's profile (first name, last name)
 */
export async function updateProfile(
  input: UpdateProfileInput
): Promise<ActionResult> {
  try {
    // Validate input
    const parsed = updateProfileSchema.safeParse(input)
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input",
      }
    }

    const { firstName, lastName } = parsed.data

    // Get current authenticated user
    const currentUser = await requireAuth()

    // Update in WorkOS
    const workos = getWorkOS()
    await workos.userManagement.updateUser({
      userId: currentUser.id,
      firstName,
      lastName,
    })

    // Update in local database
    const { env } = await getCloudflareContext()
    if (env?.DB) {
      const db = getDb(env.DB)
      const now = new Date().toISOString()
      const displayName = `${firstName} ${lastName}`.trim()

      await db
        .update(users)
        .set({
          firstName,
          lastName,
          displayName,
          updatedAt: now,
        })
        .where(eq(users.id, currentUser.id))
        .run()
    }

    return { success: true }
  } catch (error) {
    console.error("Error updating profile:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update profile",
    }
  }
}

/**
 * Change the current user's password
 * Note: WorkOS doesn't verify the current password via API - this is a UX-only field.
 * For production, consider implementing a proper password verification flow.
 */
export async function changePassword(
  input: ChangePasswordInput
): Promise<ActionResult> {
  try {
    // Validate input
    const parsed = changePasswordSchema.safeParse(input)
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input",
      }
    }

    const { newPassword } = parsed.data

    // Get current authenticated user
    const currentUser = await requireAuth()

    // Update password in WorkOS
    const workos = getWorkOS()
    await workos.userManagement.updateUser({
      userId: currentUser.id,
      password: newPassword,
    })

    return { success: true }
  } catch (error) {
    console.error("Error changing password:", error)

    // Handle specific WorkOS errors
    const errorMessage =
      error instanceof Error ? error.message : "Failed to change password"

    // Check for common error patterns
    if (errorMessage.includes("password")) {
      return {
        success: false,
        error: "Unable to change password. You may have signed in with a social provider.",
      }
    }

    return { success: false, error: errorMessage }
  }
}

/**
 * Sign out the current user
 */
export async function logout(): Promise<void> {
  await signOut()
}
