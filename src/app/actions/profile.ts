"use server"

import { getWorkOS, signOut } from "@workos-inc/authkit-nextjs"
import { getCloudflareContext } from "@/lib/db"
import { getDb } from "@/db"
import { users } from "@/db/schema"
import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { requireAuth } from "@/lib/auth"
import {
  updateProfileSchema,
  changePasswordSchema,
  type UpdateProfileInput,
  type ChangePasswordInput,
} from "@/lib/validations/profile"

type ActionResult<T = undefined> =
  | { success: true; data?: T }
  | { success: false; error: string }

const HIDDEN_WORKSPACE_PHOTO = "__hidden__"
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
    const normalized = value?.trim() || null
    if (
      normalized !== null &&
      normalized !== HIDDEN_WORKSPACE_PHOTO &&
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
    await db
      .update(users)
      .set({
        ...(slot === "dashboard"
          ? { dashboardDeskPhotoUrl: normalized }
          : { sidebarDeskPhotoUrl: normalized }),
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
