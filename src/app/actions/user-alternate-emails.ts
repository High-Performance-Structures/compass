"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod/v4"

import { actionFailure, type ActionResult } from "@/lib/action-result"
import { recordActivityEvent } from "@/lib/activity-log"
import {
  addAlternateEmail,
  listAlternateEmails,
  removeAlternateEmail,
  type AlternateEmail,
} from "@/lib/domain/identity/alternate-emails"
import { orgContext } from "@/lib/server/action-context"
import { canManageUserAccessRole, isInternalStaffRole } from "@/lib/user-roles"

/*
 * Settings → Team: a staff member's other email addresses (not for sign-in).
 * Staff may see them; admins add and remove them. Each change is recorded
 * in Activity.
 */

const userIdInput = z.string().trim().min(1).max(200)
const ADMINS_ONLY = "Only admins can change other email addresses."

export async function getUserAlternateEmails(userId: string): Promise<ActionResult<{ readonly emails: readonly AlternateEmail[]; readonly canEdit: boolean }>> {
  try {
    const id = userIdInput.parse(userId)
    const context = await orgContext()
    if (!context.success) return context
    const { db, user, organizationId } = context.data
    if (!isInternalStaffRole(user.role)) return actionFailure("Only staff can see other email addresses.")
    return { success: true, data: { emails: await listAlternateEmails(db, organizationId, id), canEdit: canManageUserAccessRole(user.role) } }
  } catch (error) {
    console.error("Failed to load other email addresses", error)
    return actionFailure("Could not load other email addresses.")
  }
}

export async function addUserAlternateEmail(userId: string, email: string): Promise<ActionResult<AlternateEmail>> {
  try {
    const id = userIdInput.parse(userId)
    const address = z.string().max(254).parse(email)
    const context = await orgContext({ mutation: true })
    if (!context.success) return context
    const { db, user, organizationId } = context.data
    if (!canManageUserAccessRole(user.role)) return actionFailure(ADMINS_ONLY)
    const result = await addAlternateEmail(db, { organizationId, userId: id, email: address, actorUserId: user.id, now: new Date().toISOString() })
    if (!result.success) return result
    await recordActivityEvent({
      db, organizationId, actor: user, category: "account",
      action: "user.alternate_email_added", entityType: "user", entityId: id,
      summary: `Added other email address ${result.data.email} (not for sign-in).`,
      metadata: { email: result.data.email },
    })
    revalidatePath("/dashboard/settings")
    return result
  } catch (error) {
    console.error("Failed to add other email address", error)
    return actionFailure("Could not add this email address.")
  }
}

export async function removeUserAlternateEmail(userId: string, alternateEmailId: string): Promise<ActionResult<{ readonly email: string }>> {
  try {
    const id = userIdInput.parse(userId)
    const rowId = userIdInput.parse(alternateEmailId)
    const context = await orgContext({ mutation: true })
    if (!context.success) return context
    const { db, user, organizationId } = context.data
    if (!canManageUserAccessRole(user.role)) return actionFailure(ADMINS_ONLY)
    const result = await removeAlternateEmail(db, { organizationId, userId: id, id: rowId })
    if (!result.success) return result
    await recordActivityEvent({
      db, organizationId, actor: user, category: "account",
      action: "user.alternate_email_removed", entityType: "user", entityId: id,
      summary: `Removed other email address ${result.data.email}.`,
      metadata: { email: result.data.email },
    })
    revalidatePath("/dashboard/settings")
    return result
  } catch (error) {
    console.error("Failed to remove other email address", error)
    return actionFailure("Could not remove this email address.")
  }
}
