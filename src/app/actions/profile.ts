"use server"

import { getWorkOS, signOut } from "@workos-inc/authkit-nextjs"
import { getCloudflareContext } from "@/lib/db"
import { getDb } from "@/db"
import {
  customers,
  projectAccessInvitations,
  projectContacts,
  users,
  vendors,
} from "@/db/schema"
import { and, eq, inArray } from "drizzle-orm"
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

type ProfileUpdateResult = {
  readonly emailVerificationRequired: boolean
  readonly verificationEmailSent: boolean
}

function nullableProfileValue(value: string): string | null {
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

/**
 * Update the signed-in user's identity in WorkOS and every linked Compass
 * contact snapshot. Once an account is active, this is the identity source of
 * truth for customer and vendor directory records linked through invitations.
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

    const { firstName, lastName, email, phone, address } = parsed.data

    // Get current authenticated user
    const currentUser = await requireAuth()

    const normalizedCurrentEmail = currentUser.email.trim().toLowerCase()
    const emailChanged = email !== normalizedCurrentEmail

    // WorkOS remains authoritative for the login email and may reject an
    // email managed by SSO or directory sync before any local values change.
    const workos = getWorkOS()
    await workos.userManagement.updateUser({
      userId: currentUser.id,
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
      const identity = {
        email,
        phone: nullableProfileValue(phone),
        address: nullableProfileValue(address),
      }

      const acceptedContactRows = await db
        .select({
          id: projectContacts.id,
          sourceEntityType: projectContacts.sourceEntityType,
          sourceEntityId: projectContacts.sourceEntityId,
        })
        .from(projectAccessInvitations)
        .innerJoin(
          projectContacts,
          eq(projectContacts.id, projectAccessInvitations.projectContactId)
        )
        .where(
          and(
            eq(projectAccessInvitations.acceptedBy, currentUser.id),
            eq(projectAccessInvitations.status, "accepted")
          )
        )

      const acceptedContactIds = Array.from(
        new Set(acceptedContactRows.map((contact) => contact.id))
      )
      const linkedCustomerIds = Array.from(
        new Set(
          acceptedContactRows.flatMap((contact) =>
            contact.sourceEntityType === "customer" && contact.sourceEntityId
              ? [contact.sourceEntityId]
              : []
          )
        )
      )
      const linkedVendorIds = Array.from(
        new Set(
          acceptedContactRows.flatMap((contact) =>
            contact.sourceEntityType === "vendor" && contact.sourceEntityId
              ? [contact.sourceEntityId]
              : []
          )
        )
      )

      await db
        .update(users)
        .set({
          firstName,
          lastName,
          displayName,
          ...identity,
          updatedAt: now,
        })
        .where(eq(users.id, currentUser.id))
        .run()

      await db
        .update(projectContacts)
        .set({
          displayName,
          ...identity,
          updatedAt: now,
        })
        .where(
          and(
            eq(projectContacts.sourceEntityType, "user"),
            eq(projectContacts.sourceEntityId, currentUser.id)
          )
        )
        .run()

      if (acceptedContactIds.length > 0) {
        await db
          .update(projectContacts)
          .set({ ...identity, updatedAt: now })
          .where(inArray(projectContacts.id, acceptedContactIds))
          .run()
      }

      if (linkedCustomerIds.length > 0) {
        await db
          .update(customers)
          .set({ ...identity, updatedAt: now })
          .where(inArray(customers.id, linkedCustomerIds))
          .run()
        await db
          .update(projectContacts)
          .set({ ...identity, updatedAt: now })
          .where(
            and(
              eq(projectContacts.sourceEntityType, "customer"),
              inArray(projectContacts.sourceEntityId, linkedCustomerIds)
            )
          )
          .run()
      }

      if (linkedVendorIds.length > 0) {
        await db
          .update(vendors)
          .set({ ...identity, updatedAt: now })
          .where(inArray(vendors.id, linkedVendorIds))
          .run()
        await db
          .update(projectContacts)
          .set({ ...identity, updatedAt: now })
          .where(
            and(
              eq(projectContacts.sourceEntityType, "vendor"),
              inArray(projectContacts.sourceEntityId, linkedVendorIds)
            )
          )
          .run()
      }

      await db
        .update(projectAccessInvitations)
        .set({ email, updatedAt: now })
        .where(
          and(
            eq(projectAccessInvitations.acceptedBy, currentUser.id),
            eq(projectAccessInvitations.status, "accepted")
          )
        )
        .run()
    }

    let verificationEmailSent = !emailChanged
    if (emailChanged) {
      try {
        await workos.userManagement.sendVerificationEmail({
          userId: currentUser.id,
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
