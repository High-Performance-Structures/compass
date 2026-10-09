"use server"

import { getWorkOS, signOut, withAuth } from "@workos-inc/authkit-nextjs"
import { getCloudflareContext } from "@/lib/db"
import { getDb } from "@/db"
import { accountDeletionRequests, users } from "@/db/schema"
import { and, desc, eq, or } from "drizzle-orm"
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

export type AccountDeletionRequestState = {
  readonly status: "pending" | "processing"
  readonly requestedAt: string
}

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

type ProfileUpdateResult = {
  readonly emailVerificationRequired: boolean
  readonly verificationEmailSent: boolean
}

async function authenticatedWorkOSUserId(): Promise<string> {
  const session = await withAuth()
  if (!session?.user?.id) {
    throw new Error("Your authentication session has expired. Sign in again.")
  }
  return session.user.id
}

/**
 * Update account identity only. Business contact details belong to the shared
 * directories and must go through the reviewed Sage contact-change workflow.
 */
export async function updateProfile(
  input: UpdateProfileInput
): Promise<ActionResult<ProfileUpdateResult>> {
  try {
    // Validate input
    const parsed = updateProfileSchema.safeParse(input)
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input",
      }
    }

    const { firstName, lastName, email } = parsed.data

    // Get current authenticated user
    const currentUser = await requireAuth()
    const workosUserId = await authenticatedWorkOSUserId()

    const normalizedCurrentEmail = currentUser.email.trim().toLowerCase()
    const emailChanged = email !== normalizedCurrentEmail

    // WorkOS remains authoritative for the login email and may reject an
    // email managed by SSO or directory sync before any local values change.
    const workos = getWorkOS()
    await workos.userManagement.updateUser({
      userId: workosUserId,
      firstName,
      lastName,
      ...(emailChanged ? { email } : {}),
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
          email,
          updatedAt: now,
        })
        .where(eq(users.id, currentUser.id))
        .run()
    }

    let verificationEmailSent = !emailChanged
    if (emailChanged) {
      try {
        await workos.userManagement.sendVerificationEmail({
          userId: workosUserId,
        })
        verificationEmailSent = true
      } catch (error) {
        console.warn("Profile email changed, but verification email failed:", error)
      }
    }

    revalidatePath("/dashboard", "layout")
    revalidatePath("/dashboard/contacts")
    revalidatePath("/dashboard/customers")
    revalidatePath("/dashboard/vendors")
    revalidatePath("/dashboard/projects", "layout")
    return {
      success: true,
      data: {
        emailVerificationRequired: emailChanged,
        verificationEmailSent,
      },
    }
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
    await requireAuth()
    const workosUserId = await authenticatedWorkOSUserId()

    // Update password in WorkOS
    const workos = getWorkOS()
    await workos.userManagement.updateUser({
      userId: workosUserId,
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

async function activeAccountDeletionRequest(
  userId: string
): Promise<AccountDeletionRequestState | null> {
  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const request = await db
    .select({
      status: accountDeletionRequests.status,
      requestedAt: accountDeletionRequests.requestedAt,
    })
    .from(accountDeletionRequests)
    .where(
      and(
        eq(accountDeletionRequests.userId, userId),
        or(
          eq(accountDeletionRequests.status, "pending"),
          eq(accountDeletionRequests.status, "processing")
        )
      )
    )
    .orderBy(desc(accountDeletionRequests.requestedAt))
    .limit(1)
    .get()

  if (!request) return null
  return {
    status: request.status === "processing" ? "processing" : "pending",
    requestedAt: request.requestedAt,
  }
}

/**
 * Return the signed-in user's active deletion request, if one exists.
 */
export async function getAccountDeletionRequest(): Promise<
  ActionResult<AccountDeletionRequestState | null>
> {
  try {
    const currentUser = await requireAuth()
    return {
      success: true,
      data: await activeAccountDeletionRequest(currentUser.id),
    }
  } catch (error) {
    console.error("Error loading account deletion request:", error)
    return {
      success: false,
      error: "Unable to load the account deletion request status.",
    }
  }
}

/**
 * Start a reviewed account-deletion workflow. Records with contractual,
 * financial, security, or legal retention duties are handled during review;
 * the user's removable personal data and WorkOS identity are then deleted.
 */
export async function requestAccountDeletion(
  confirmation: string
): Promise<ActionResult<AccountDeletionRequestState>> {
  try {
    if (confirmation.trim() !== "DELETE") {
      return { success: false, error: 'Type "DELETE" to confirm.' }
    }

    const currentUser = await requireAuth()
    const existing = await activeAccountDeletionRequest(currentUser.id)
    if (existing) return { success: true, data: existing }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const now = new Date().toISOString()
    await db
      .insert(accountDeletionRequests)
      .values({
        id: crypto.randomUUID(),
        userId: currentUser.id,
        emailSnapshot: currentUser.email,
        displayNameSnapshot: currentUser.displayName,
        status: "pending",
        requestedAt: now,
        updatedAt: now,
      })
      .run()

    revalidatePath("/dashboard/account")
    return {
      success: true,
      data: { status: "pending", requestedAt: now },
    }
  } catch (error) {
    console.error("Error requesting account deletion:", error)
    return {
      success: false,
      error: "Unable to submit the account deletion request.",
    }
  }
}

/**
 * Let a user recover from a deletion request until processing begins.
 */
export async function cancelAccountDeletionRequest(): Promise<ActionResult> {
  try {
    const currentUser = await requireAuth()
    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const request = await db
      .select({ id: accountDeletionRequests.id })
      .from(accountDeletionRequests)
      .where(
        and(
          eq(accountDeletionRequests.userId, currentUser.id),
          eq(accountDeletionRequests.status, "pending")
        )
      )
      .orderBy(desc(accountDeletionRequests.requestedAt))
      .limit(1)
      .get()

    if (!request) {
      return {
        success: false,
        error: "This request is already being processed or is no longer active.",
      }
    }

    const now = new Date().toISOString()
    const updateResult = await db
      .update(accountDeletionRequests)
      .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
      .where(
        and(
          eq(accountDeletionRequests.id, request.id),
          eq(accountDeletionRequests.userId, currentUser.id),
          eq(accountDeletionRequests.status, "pending")
        )
      )
      .run()

    if ((updateResult.meta.changes ?? 0) !== 1) {
      return {
        success: false,
        error: "This request is already being processed or is no longer active.",
      }
    }

    revalidatePath("/dashboard/account")
    return { success: true }
  } catch (error) {
    console.error("Error cancelling account deletion:", error)
    return {
      success: false,
      error: "Unable to cancel the account deletion request.",
    }
  }
}

/**
 * Sign out the current user
 */
export async function logout(): Promise<void> {
  await signOut()
}
