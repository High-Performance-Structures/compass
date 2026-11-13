/**
 * Sign-in reads and writes for Compass accounts (issue #1329). auth.ts owns
 * the WorkOS session and cookies; everything that reads or changes an
 * account, its company memberships or its project invitations at sign-in
 * lives here.
 *
 * Claiming an invitation: an open ("sent") invitation for the account's
 * email gives the person the invited role on that job, joins them to the
 * inviting company as an outside member (staff keep their staff role), opens
 * the owner or sub/vendor conversation, and marks the invitation accepted.
 * The membership is granted only while the invitation is open and its
 * contact still on the job, so a revoke or removal mid sign-in wins.
 * An invitation whose WorkOS link has lapsed is marked expired instead.
 * Status changes follow invitationMachine (invitation-machine.ts).
 */
import { removeLostJobConversationAccess } from "@/lib/conversations/shared-client-conversations"
import { and, desc, eq, sql } from "drizzle-orm"

import { organizationMembers, projectAccessInvitations, users, type User } from "@/db/schema"
import { projectContactActiveCondition, projectContactPhoneAndAddress } from "@/lib/domain/contacts/resolved-project-contacts"
import { removeProjectMemberGrant, upsertProjectMemberRole } from "@/lib/domain/project/store"
import { ensureProjectAudienceConversation } from "@/lib/project-audience-conversations"
import type { Db } from "@/lib/server/action-context"
import { isExternalProjectRole, projectAudienceForRole } from "@/lib/user-roles"

import {
  ensureExternalOrganizationMembership,
  invitationIsOpen,
  invitationOpenCondition,
  markProjectAccessInvitationAccepted,
  markProjectAccessInvitationExpired,
  updateUser,
} from "./store"

export function normalizedEmailAddress(email: string): string {
  return email.trim().toLowerCase()
}

/** The account with this id; a query, so sign-in can batch it with its other reads. */
export function accountByIdQuery(db: Db, userId: string) {
  return db.select().from(users).where(eq(users.id, userId)).limit(1)
}

export async function accountById(db: Db, userId: string): Promise<User | undefined> {
  return db.select().from(users).where(eq(users.id, userId)).get()
}

/** The account with this email, ignoring case and surrounding spaces. */
export async function accountByEmail(db: Db, email: string): Promise<User | undefined> {
  return db
    .select()
    .from(users)
    .where(sql`lower(trim(${users.email})) = ${normalizedEmailAddress(email)}`)
    .get()
}

/** Open invitations for this email, newest first; a query, so sign-in can batch it. */
export function pendingInvitationsQuery(db: Db, normalizedEmail: string) {
  return db
    .select({
      id: projectAccessInvitations.id,
      organizationId: projectAccessInvitations.organizationId,
      projectId: projectAccessInvitations.projectId,
      projectContactId: projectAccessInvitations.projectContactId,
      role: projectAccessInvitations.role,
      invitedBy: projectAccessInvitations.invitedBy,
      workosExpiresAt: projectAccessInvitations.workosExpiresAt,
    })
    .from(projectAccessInvitations)
    .where(
      and(
        eq(projectAccessInvitations.status, "sent"),
        sql`lower(trim(${projectAccessInvitations.email})) = ${normalizedEmail}`,
      ),
    )
    .orderBy(desc(projectAccessInvitations.invitedAt))
}

export type PendingInvitation = Awaited<ReturnType<typeof pendingInvitationsQuery>>[number]

type ClaimingAccount = {
  readonly id: string
  readonly phone: string | null
  readonly address: string | null
}

export type ClaimedInvitation = { readonly organizationId: string; readonly role: string }

function isLapsed(invitation: PendingInvitation, now: string): boolean {
  return invitation.workosExpiresAt !== null && invitation.workosExpiresAt <= now
}

/**
 * Fills the account's empty phone and address from the first live
 * invitation whose contact has either.
 */
async function fillProfileFromInvitedContact(
  db: Db,
  account: ClaimingAccount,
  invitations: readonly PendingInvitation[],
  now: string,
): Promise<void> {
  if (account.phone && account.address) return
  const live = invitations.filter((invitation) => !isLapsed(invitation, now))
  const contactIds = live.flatMap((invitation) => (invitation.projectContactId ? [invitation.projectContactId] : []))
  const details = await projectContactPhoneAndAddress(db, contactIds)
  const source = live
    .map((invitation) => (invitation.projectContactId ? details.get(invitation.projectContactId) : undefined))
    .find((contact) => contact && (contact.phone || contact.address))
  if (!source) return
  if ((!account.phone && source.phone) || (!account.address && source.address)) {
    await updateUser(db, account.id, {
      phone: account.phone ?? source.phone,
      address: account.address ?? source.address,
      updatedAt: now,
    })
  }
}

/** Claims these open invitations for the account; returns the first claimed, if any. */
export async function claimProjectAccessInvitations(
  db: Db,
  account: ClaimingAccount,
  invitations: readonly PendingInvitation[],
  now: string,
): Promise<ClaimedInvitation | null> {
  // Nearly every request has nothing pending; skip all further work.
  if (invitations.length === 0) return null
  await fillProfileFromInvitedContact(db, account, invitations, now)

  let claimed: ClaimedInvitation | null = null
  for (const invitation of invitations) {
    if (isLapsed(invitation, now)) {
      await markProjectAccessInvitationExpired(db, invitation.id, now)
      continue
    }
    // The list was read earlier in the request; staff may have revoked it since.
    // Re-check right before granting anything (invitationMachine: only a sent
    // invitation can be accepted).
    if (!(await invitationIsOpen(db, invitation.id))) continue

    const organizationMembership = await db
      .select({ role: organizationMembers.role })
      .from(organizationMembers)
      .where(and(eq(organizationMembers.userId, account.id), eq(organizationMembers.organizationId, invitation.organizationId)))
      .get()
    const preservedOrganizationRole =
      organizationMembership && !isExternalProjectRole(organizationMembership.role) ? organizationMembership.role : null
    const assignedRole = preservedOrganizationRole ?? invitation.role

    // The job membership lands only while the invitation is still open and its
    // contact is still on the job, checked in the same statement: staff who
    // revoke the invitation or remove the contact mid sign-in always win.
    const grant = await upsertProjectMemberRole(
      db,
      { projectId: invitation.projectId, userId: account.id, role: assignedRole, now },
      {
        onlyIf: and(
          invitationOpenCondition(invitation.id),
          invitation.projectContactId ? projectContactActiveCondition(invitation.projectContactId) : undefined,
        ),
      },
    )
    if (!grant.written) continue

    if (isExternalProjectRole(invitation.role) && !preservedOrganizationRole) {
      await ensureExternalOrganizationMembership(db, {
        organizationId: invitation.organizationId,
        userId: account.id,
        role: invitation.role,
        now,
      })
    }

    const audience = projectAudienceForRole(invitation.role)
    if (audience) {
      await ensureProjectAudienceConversation({
        db,
        projectId: invitation.projectId,
        organizationId: invitation.organizationId,
        audience,
        contactId: audience === "owner" ? null : invitation.projectContactId,
        importedContactId: invitation.projectContactId,
        externalUserId: account.id,
        createdBy: invitation.invitedBy,
        now,
      })
    }

    // Grants run before accept so a failure leaves the invitation open to retry
    // on the next request; they are idempotent. Accept is compare-and-set.
    if (!(await markProjectAccessInvitationAccepted(db, invitation.id, account.id, now))) {
      // Revoked between the grant and the accept: undo a membership this claim
      // created (one that existed before is left alone).
      if (grant.createdId) {
        await removeProjectMemberGrant(db, grant.createdId)
        await removeLostJobConversationAccess({ db, organizationId: invitation.organizationId, projectId: invitation.projectId, userIds: [account.id] })
      }
      console.warn(`[sign-in] invitation ${invitation.id} changed while being claimed; the new job membership was withdrawn`)
      continue
    }
    claimed ??= { organizationId: invitation.organizationId, role: assignedRole }
  }
  return claimed
}

/** Looks up and claims an account's open invitations (sign-in callbacks). */
export async function claimInvitationsForAccount(
  db: Db,
  account: ClaimingAccount & { readonly email: string },
  now: string,
): Promise<ClaimedInvitation | null> {
  const email = normalizedEmailAddress(account.email)
  if (!email) return null
  const invitations = await pendingInvitationsQuery(db, email)
  return claimProjectAccessInvitations(db, account, invitations, now)
}
