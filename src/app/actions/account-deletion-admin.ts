"use server"

import { getWorkOS } from "@workos-inc/authkit-nextjs"
import { and, desc, eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import { accountDeletionRequests, organizationMembers } from "@/db/schema"
import { isWorkOSNotFound, runAccountDeletion } from "@/lib/account-deletion"
import { requireAuth, type AuthUser } from "@/lib/auth"
import { isWorkOSConfigured } from "@/lib/auth-config"
import { getCloudflareContext } from "@/lib/db"
import { canManageUserAccess } from "@/lib/permissions"

type ActionResult<T = undefined> =
  | { success: true; data?: T }
  | { success: false; error: string }

export type AccountDeletionRequestStatus =
  | "pending"
  | "processing"
  | "completed"
  | "cancelled"

export type AdminAccountDeletionRequest = {
  readonly id: string
  readonly userId: string | null
  readonly email: string | null
  readonly displayName: string | null
  readonly status: AccountDeletionRequestStatus
  readonly requestedAt: string
  readonly processingStartedAt: string | null
  readonly completedAt: string | null
  readonly cancelledAt: string | null
}

const STATUSES: readonly AccountDeletionRequestStatus[] = [
  "pending",
  "processing",
  "completed",
  "cancelled",
]

function toStatus(value: string): AccountDeletionRequestStatus {
  return STATUSES.find((status) => status === value) ?? "pending"
}

type AdminContext = {
  readonly user: AuthUser
  readonly organizationId: string
  readonly db: ReturnType<typeof getDb>
}

/** Null when the signed-in person can't manage deletion requests. */
async function adminContext(): Promise<AdminContext | null> {
  const user = await requireAuth()
  if (!canManageUserAccess(user) || !user.organizationId) return null
  const { env } = await getCloudflareContext()
  return { user, organizationId: user.organizationId, db: getDb(env.DB) }
}

const NOT_ALLOWED = "Only admins can manage account deletion requests."

/** Only requests from people in the admin's own organization are visible. */
function inOrganization(organizationId: string) {
  return and(
    eq(organizationMembers.userId, accountDeletionRequests.userId),
    eq(organizationMembers.organizationId, organizationId)
  )
}

async function loadRequest(
  db: ReturnType<typeof getDb>,
  organizationId: string,
  requestId: string
) {
  return db
    .select({
      id: accountDeletionRequests.id,
      userId: accountDeletionRequests.userId,
      status: accountDeletionRequests.status,
    })
    .from(accountDeletionRequests)
    .innerJoin(organizationMembers, inOrganization(organizationId))
    .where(eq(accountDeletionRequests.id, requestId))
    .get()
}

/**
 * Open requests first, then the most recent closed ones, for the admin's
 * organization. Returns null for anyone who can't manage them.
 */
export async function getAccountDeletionRequestsForAdmin(): Promise<
  readonly AdminAccountDeletionRequest[] | null
> {
  try {
    const context = await adminContext()
    if (!context) return null
    const { db, organizationId } = context
    const columns = {
      id: accountDeletionRequests.id,
      userId: accountDeletionRequests.userId,
      email: accountDeletionRequests.emailSnapshot,
      displayName: accountDeletionRequests.displayNameSnapshot,
      status: accountDeletionRequests.status,
      requestedAt: accountDeletionRequests.requestedAt,
      processingStartedAt: accountDeletionRequests.processingStartedAt,
      completedAt: accountDeletionRequests.completedAt,
      cancelledAt: accountDeletionRequests.cancelledAt,
    }
    const [open, closed] = await Promise.all([
      db
        .select(columns)
        .from(accountDeletionRequests)
        .innerJoin(organizationMembers, inOrganization(organizationId))
        .where(inArray(accountDeletionRequests.status, ["pending", "processing"]))
        .orderBy(accountDeletionRequests.requestedAt)
        .all(),
      db
        .select(columns)
        .from(accountDeletionRequests)
        .innerJoin(organizationMembers, inOrganization(organizationId))
        .where(inArray(accountDeletionRequests.status, ["completed", "cancelled"]))
        .orderBy(desc(accountDeletionRequests.updatedAt))
        .limit(20)
        .all(),
    ])
    return [...open, ...closed].map((row) => ({
      ...row,
      status: toStatus(row.status),
    }))
  } catch (error) {
    console.error("Loading account deletion requests failed", error)
    return null
  }
}

/**
 * Move a pending request into processing. From here the person can no
 * longer cancel it.
 */
export async function startAccountDeletionProcessing(
  requestId: string
): Promise<ActionResult> {
  try {
    const context = await adminContext()
    if (!context) return { success: false, error: NOT_ALLOWED }
    const { user, organizationId, db } = context
    const request = await loadRequest(db, organizationId, requestId)
    if (!request) return { success: false, error: "Request not found." }
    if (request.status !== "pending") {
      return { success: false, error: "Only pending requests can be started." }
    }

    const now = new Date().toISOString()
    const result = await db
      .update(accountDeletionRequests)
      .set({
        status: "processing",
        processingStartedAt: now,
        processingStartedBy: user.id,
        updatedAt: now,
      })
      .where(
        and(
          eq(accountDeletionRequests.id, requestId),
          eq(accountDeletionRequests.status, "pending")
        )
      )
      .run()
    if ((result.meta.changes ?? 0) !== 1) {
      return {
        success: false,
        error: "The request changed while you were viewing it. Refresh and try again.",
      }
    }

    revalidatePath("/dashboard/settings")
    return { success: true }
  } catch (error) {
    console.error("Starting account deletion failed", error)
    return { success: false, error: "The request could not be started." }
  }
}

/**
 * Delete the person's sign-in identity and personal data, de-identify their
 * user row and close the request. Retained project and financial records
 * keep pointing at the de-identified row.
 */
export async function completeAccountDeletion(
  requestId: string,
  confirmation: string
): Promise<ActionResult> {
  try {
    if (confirmation.trim() !== "DELETE") {
      return { success: false, error: 'Type "DELETE" to confirm.' }
    }

    const context = await adminContext()
    if (!context) return { success: false, error: NOT_ALLOWED }
    const { user, organizationId, db } = context
    const request = await loadRequest(db, organizationId, requestId)
    if (!request || !request.userId) {
      return { success: false, error: "Request not found." }
    }
    if (request.status !== "processing") {
      return {
        success: false,
        error: "Start processing the request before completing it.",
      }
    }
    if (request.userId === user.id) {
      return {
        success: false,
        error: "Another admin must complete your own deletion request.",
      }
    }

    // Remove the sign-in identity first. If this fails, nothing in Compass
    // has changed and the admin can retry.
    if (isWorkOSConfigured()) {
      try {
        await getWorkOS().userManagement.deleteUser(request.userId)
      } catch (error) {
        if (!isWorkOSNotFound(error)) throw error
      }
    }

    await runAccountDeletion(db, {
      requestId,
      userId: request.userId,
      completedBy: user.id,
      now: new Date().toISOString(),
    })

    revalidatePath("/dashboard/settings")
    revalidatePath("/dashboard/people")
    return { success: true }
  } catch (error) {
    console.error("Completing account deletion failed", error)
    return {
      success: false,
      error: "Deletion didn't finish, so the request is still open. Try again.",
    }
  }
}
