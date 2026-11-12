"use server"

import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { membershipsView, peopleView } from "@/lib/domain/identity/views"
import { actionFailure, errorMessage } from "@/lib/action-result"
import { recordActivityEvent } from "@/lib/activity-log"
import { encrypt } from "@/lib/crypto"
import {
  deleteDriveConnection,
  readConnectionWorkspaceDomain,
  replaceDriveConnection,
  setConnectionSharedDrive,
} from "@/lib/domain/documents/drive-connection-store"
import { getOrgGoogleAuth, openDriveSession } from "@/lib/domain/documents/drive-session"
import { updateUser } from "@/lib/domain/identity/store"
import { DriveClient } from "@/lib/google/client/drive-client"
import { getGoogleConfig, getGoogleCryptoSalt, parseServiceAccountKey } from "@/lib/google/config"
import { requirePermission } from "@/lib/permissions"
import {
  describeSenderAddressConflict,
  findSenderAddressConflict,
  isAddressInWorkspaceDomain,
  normalizeEmailAddress,
} from "@/lib/sender-identity-guard"
import { requireUserContext, userContext } from "@/lib/server/action-context"

const people = peopleView()
const memberships = membershipsView()

/*
 * Connecting Compass to the company's Google Workspace (Settings): the
 * service-account key, the shared drive files open in, and each person's
 * Google address. Browsing files is google-drive-files.ts; Field Mode's
 * project documents are google-drive-field.ts. How the service account acts
 * as each person: docs/modules/google-drive.md.
 */

type DoneResult = { success: true } | { success: false; error: string }

type ConnectionStatus = {
  connected: boolean
  workspaceDomain: string | null
  sharedDriveName: string | null
}

const NOT_CONNECTED: ConnectionStatus = { connected: false, workspaceDomain: null, sharedDriveName: null }

/** Never fails: anything that goes wrong reads as "not connected". */
export async function getGoogleDriveConnectionStatus(): Promise<ConnectionStatus> {
  try {
    const context = await userContext()
    if (!context.success) return NOT_CONNECTED
    requirePermission(context.data.user, "document", "read")
    const auth = await getOrgGoogleAuth(context.data.db)
    if (!auth) return NOT_CONNECTED
    return { connected: true, workspaceDomain: auth.workspaceDomain, sharedDriveName: auth.sharedDriveName }
  } catch {
    return NOT_CONNECTED
  }
}

/**
 * Saves the service-account key (encrypted) after one test call proves
 * domain-wide delegation works. Replaces any earlier connection.
 */
export async function connectGoogleDrive(serviceAccountKeyJson: string, workspaceDomain: string): Promise<DoneResult> {
  try {
    const { user, db, env } = await requireUserContext()
    requirePermission(user, "organization", "update")

    const client = new DriveClient({ serviceAccountKey: parseServiceAccountKey(serviceAccountKeyJson) })
    try {
      await client.getStorageQuota(user.email)
    } catch (testErr) {
      return actionFailure(
        `Failed to connect: ${errorMessage(testErr, "Unknown error")}. Check domain-wide delegation.`
      )
    }

    const encryptedKey = await encrypt(serviceAccountKeyJson, getGoogleConfig(env).encryptionKey, getGoogleCryptoSalt())
    const now = new Date().toISOString()
    await replaceDriveConnection(db, {
      id: crypto.randomUUID(),
      organizationId: "org-1",
      serviceAccountKeyEncrypted: encryptedKey,
      workspaceDomain,
      connectedBy: user.id,
      createdAt: now,
      updatedAt: now,
    })

    revalidatePath("/dashboard/files")
    return { success: true }
  } catch (err) {
    return actionFailure(errorMessage(err, "Failed to connect Google Drive"))
  }
}

export async function disconnectGoogleDrive(): Promise<DoneResult> {
  try {
    const { user, db } = await requireUserContext()
    requirePermission(user, "organization", "delete")
    await deleteDriveConnection(db)
    revalidatePath("/dashboard/files")
    return { success: true }
  } catch (err) {
    return actionFailure(errorMessage(err, "Failed to disconnect"))
  }
}

/** Shared drives the signed-in admin can see, for the shared-drive picker. */
export async function listAvailableSharedDrives(): Promise<
  | { success: true; drives: ReadonlyArray<{ id: string; name: string }> }
  | { success: false; error: string }
> {
  try {
    const opened = await openDriveSession("organization", "update")
    if (!opened.success) return opened
    const { client, googleEmail } = opened.session
    const result = await client.listSharedDrives(googleEmail)
    return { success: true, drives: result.drives.map(d => ({ id: d.id, name: d.name })) }
  } catch (err) {
    return actionFailure(errorMessage(err, "Failed"))
  }
}

/** The shared drive the Files page opens in; null for My Drive. */
export async function selectSharedDrive(driveId: string | null, driveName: string | null): Promise<DoneResult> {
  try {
    const { user, db } = await requireUserContext()
    requirePermission(user, "organization", "update")

    const auth = await getOrgGoogleAuth(db)
    if (!auth) return actionFailure("Google Drive not connected")

    await setConnectionSharedDrive(db, auth.id, driveId, driveName)

    revalidatePath("/dashboard/files")
    return { success: true }
  } catch (err) {
    return actionFailure(errorMessage(err, "Failed"))
  }
}

/**
 * Set or clear a user's Google Workspace address. Compass impersonates this
 * address for Drive and sends mail as it, so the target must be an active
 * member of the caller's organization and the address must be an unclaimed
 * mailbox in that organization's connected Workspace domain.
 */
export async function updateUserGoogleEmail(userId: string, googleEmail: string | null): Promise<DoneResult> {
  try {
    const { user, db } = await requireUserContext()
    requirePermission(user, "user", "update")
    if (!user.organizationId) {
      return actionFailure("No active organization selected")
    }
    const organizationId = user.organizationId

    const target = await db
      .select({
        id: people.id,
        email: people.email,
        googleEmail: people.googleEmail,
        isActive: people.isActive,
      })
      .from(people)
      .innerJoin(
        memberships,
        and(eq(memberships.userId, people.id), eq(memberships.organizationId, organizationId))
      )
      .where(eq(people.id, userId))
      .get()
    if (!target || !target.isActive) {
      return actionFailure("User not found in this organization")
    }

    let nextGoogleEmail: string | null = null
    if (googleEmail !== null && googleEmail.trim() !== "") {
      const address = normalizeEmailAddress(googleEmail)
      if (!address) {
        return actionFailure("Enter a valid email address")
      }
      const workspaceDomain = await readConnectionWorkspaceDomain(db, organizationId)
      if (workspaceDomain === null) {
        return actionFailure("Connect Google Workspace before setting Google emails")
      }
      if (!isAddressInWorkspaceDomain(address, workspaceDomain)) {
        return actionFailure(`Google email must be an address in ${workspaceDomain}`)
      }
      const conflict = await findSenderAddressConflict(db, {
        organizationId,
        address,
        excludeUserId: target.id,
      })
      if (conflict) {
        return actionFailure(describeSenderAddressConflict(conflict))
      }
      nextGoogleEmail = address
    }

    if (target.googleEmail === nextGoogleEmail) {
      return { success: true }
    }

    await updateUser(db, target.id, {
      googleEmail: nextGoogleEmail,
      updatedAt: new Date().toISOString(),
    })

    await recordActivityEvent({
      db,
      organizationId,
      actor: user,
      category: "account",
      action: nextGoogleEmail ? "user.google_email_set" : "user.google_email_cleared",
      entityType: "user",
      entityId: target.id,
      summary: nextGoogleEmail
        ? `Set Google email for ${target.email} to ${nextGoogleEmail}`
        : `Removed Google email override for ${target.email}`,
      metadata: {
        previousGoogleEmail: target.googleEmail,
        googleEmail: nextGoogleEmail,
      },
    })

    revalidatePath("/dashboard/people")
    return { success: true }
  } catch (err) {
    return actionFailure(errorMessage(err, "Failed to update email"))
  }
}
