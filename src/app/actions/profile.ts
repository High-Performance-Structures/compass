"use server"

import { getWorkOS, signOut } from "@workos-inc/authkit-nextjs"
import { getCloudflareContext } from "@/lib/db"
import { getDb } from "@/db"
import { organizationMembers, organizations, users } from "@/db/schema"
import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { requireAuth } from "@/lib/auth"
import { isDemoUser } from "@/lib/demo"
import { isInternalStaffRole } from "@/lib/user-roles"
import {
  canManageWorkspacePhoto,
  WORKSPACE_PHOTO_REMOVED,
} from "@/lib/workspace-photo-policy"
import {
  updateProfileSchema,
  changePasswordSchema,
  type UpdateProfileInput,
  type ChangePasswordInput,
} from "@/lib/validations/profile"

type ActionResult<T = undefined> =
  | { success: true; data?: T }
  | { success: false; error: string }

const MAX_WORKSPACE_PHOTO_LENGTH = 680_000
const SAFE_IMAGE_DATA_URL =
  /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/]+={0,2}$/i

export async function updateWorkspacePhoto(
  slot: "dashboard" | "sidebar",
  value: string | null
): Promise<ActionResult> {
  try {
    if (slot !== "dashboard" && slot !== "sidebar") {
      return { success: false, error: "Select a valid workspace photo." }
    }
    const currentUser = await requireAuth()
    if (
      !currentUser.organizationId ||
      !currentUser.isActive ||
      currentUser.organizationType !== "internal" ||
      isDemoUser(currentUser.id) ||
      !isInternalStaffRole(currentUser.role)
    ) {
      return {
        success: false,
        error: "Desk photos are available to internal staff only.",
      }
    }
    const normalized = value?.trim() || WORKSPACE_PHOTO_REMOVED
    if (
      normalized !== WORKSPACE_PHOTO_REMOVED &&
      (
        normalized.length > MAX_WORKSPACE_PHOTO_LENGTH ||
        !SAFE_IMAGE_DATA_URL.test(normalized)
      )
    ) {
      return {
        success: false,
        error: "Use a JPEG, PNG, or WebP image under 500 KB.",
      }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const membership = await db
      .select({
        id: organizationMembers.id,
        organizationIsActive: organizations.isActive,
      })
      .from(organizationMembers)
      .innerJoin(
        organizations,
        eq(organizations.id, organizationMembers.organizationId)
      )
      .where(
        and(
          eq(organizationMembers.userId, currentUser.id),
          eq(organizationMembers.organizationId, currentUser.organizationId)
        )
      )
      .limit(1)
      .get()
    if (
      !membership ||
      !membership.organizationIsActive ||
      !canManageWorkspacePhoto({
        actor: {
          userId: currentUser.id,
          organizationId: currentUser.organizationId,
          organizationType: currentUser.organizationType,
          role: currentUser.role,
          isActive: currentUser.isActive,
          isDemo: isDemoUser(currentUser.id),
        },
        photo: {
          userId: currentUser.id,
          organizationId: currentUser.organizationId,
        },
      })
    ) {
      return {
        success: false,
        error: "Desk photos are not available for this account.",
      }
    }
    await db
      .update(users)
      .set({
        ...(slot === "dashboard"
          ? {
              dashboardDeskPhotoUrl: normalized,
              dashboardDeskPhotoOrganizationId: currentUser.organizationId,
            }
          : {
              sidebarDeskPhotoUrl: normalized,
              sidebarDeskPhotoOrganizationId: currentUser.organizationId,
            }),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.id, currentUser.id))
      .run()

    revalidatePath("/dashboard", "layout")
    return { success: true }
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
