/**
 * The only code that writes the identity tables (architecture standard,
 * section 1): users, organization memberships, project access invitations
 * (including their welcome-email queue) and account deletion requests.
 * Callers resolve access first; nothing here checks who is asking.
 * Functions named `…Statement` return a statement for the caller's
 * `db.batch`, so writes that must land together stay in one batch.
 */
import { and, eq, inArray, lte, notInArray, or, sql } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"

import {
  accountDeletionRequests,
  organizationMembers,
  projectAccessInvitations,
  users,
  type NewOrganizationMember,
  type NewProjectAccessInvitation,
  type NewUser,
} from "@/db/schema"
import { PERSONAL_DATA_TABLES } from "@/lib/account-deletion"
import { deleteProjectSavedViewsOwnedByStatements, deleteSavedViewDefaultsForUserStatement } from "@/lib/domain/settings/store"
import type { Db } from "@/lib/server/action-context"

import { deidentifiedUserValues, externalOrganizationRole } from "./rules"

type Statement = BatchItem<"sqlite">
type UserChanges = Partial<Omit<NewUser, "id" | "createdAt">>
type ProjectAccessInvitation = typeof projectAccessInvitations.$inferSelect

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function insertUser(db: Db, row: NewUser): Promise<void> {
  await db.insert(users).values(row).run()
}

export async function updateUser(db: Db, userId: string, changes: UserChanges): Promise<void> {
  await db.update(users).set(changes).where(eq(users.id, userId)).run()
}

export function updateUserStatement(db: Db, userId: string, changes: UserChanges): Statement {
  return db.update(users).set(changes).where(eq(users.id, userId))
}

// ---------------------------------------------------------------------------
// Organization memberships
// ---------------------------------------------------------------------------

export async function insertOrganizationMember(db: Db, row: NewOrganizationMember): Promise<void> {
  await db.insert(organizationMembers).values(row).run()
}

export function insertOrganizationMemberStatement(db: Db, row: NewOrganizationMember): Statement {
  return db.insert(organizationMembers).values(row)
}

export async function setOrganizationMemberRole(db: Db, membershipId: string, role: string): Promise<void> {
  await db.update(organizationMembers).set({ role }).where(eq(organizationMembers.id, membershipId)).run()
}

/**
 * Gives an invited owner or vendor a membership in the inviting organization
 * with the external role, or moves their existing membership to that role.
 */
export async function ensureExternalOrganizationMembership(
  db: Db,
  input: {
    readonly organizationId: string
    readonly userId: string
    readonly role: string
    readonly now: string
  },
): Promise<void> {
  const existing = await db
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.userId, input.userId), eq(organizationMembers.organizationId, input.organizationId)))
    .get()
  const role = externalOrganizationRole(input.role)

  if (existing) {
    await setOrganizationMemberRole(db, existing.id, role)
    return
  }

  await insertOrganizationMember(db, {
    id: crypto.randomUUID(),
    organizationId: input.organizationId,
    userId: input.userId,
    role,
    joinedAt: input.now,
  })
}

// ---------------------------------------------------------------------------
// Project access invitations
// ---------------------------------------------------------------------------

/** Inserts an invitation unless the one-queued-welcome index already holds one; returns the inserted id, if any. */
export async function insertProjectAccessInvitation(
  db: Db,
  row: NewProjectAccessInvitation,
): Promise<readonly { readonly id: string }[]> {
  return db.insert(projectAccessInvitations).values(row).onConflictDoNothing().returning({ id: projectAccessInvitations.id })
}

export async function markProjectAccessInvitationExpired(db: Db, invitationId: string, now: string): Promise<void> {
  await db
    .update(projectAccessInvitations)
    .set({ status: "expired", updatedAt: now })
    .where(eq(projectAccessInvitations.id, invitationId))
    .run()
}

export async function markProjectAccessInvitationAccepted(
  db: Db,
  invitationId: string,
  acceptedBy: string,
  now: string,
): Promise<void> {
  await db
    .update(projectAccessInvitations)
    .set({ status: "accepted", acceptedBy, acceptedAt: now, updatedAt: now })
    .where(eq(projectAccessInvitations.id, invitationId))
    .run()
}

const REVOKED_WITH_CANCELLED_EMAIL = {
  status: "revoked",
  emailStatus: "cancelled",
  emailNextAttemptAt: null,
  emailClaimToken: null,
  emailClaimedAt: null,
} as const

/** Revokes a contact's still-pending invitations and cancels their welcome emails (email changed). */
export async function revokePendingContactInvitations(
  db: Db,
  input: { readonly projectId: string; readonly contactId: string; readonly now: string },
): Promise<void> {
  await db
    .update(projectAccessInvitations)
    .set({ ...REVOKED_WITH_CANCELLED_EMAIL, updatedAt: input.now })
    .where(
      and(
        eq(projectAccessInvitations.projectId, input.projectId),
        eq(projectAccessInvitations.projectContactId, input.contactId),
        eq(projectAccessInvitations.status, "sent"),
      ),
    )
    .run()
}

/** Revokes every invitation for a contact being removed from the project. */
export async function revokeContactInvitations(
  db: Db,
  input: { readonly projectId: string; readonly contactId: string; readonly now: string },
): Promise<void> {
  await db
    .update(projectAccessInvitations)
    .set({ ...REVOKED_WITH_CANCELLED_EMAIL, updatedAt: input.now })
    .where(
      and(
        eq(projectAccessInvitations.projectId, input.projectId),
        eq(projectAccessInvitations.projectContactId, input.contactId),
      ),
    )
}

// Welcome-email queue on project_access_invitations. See
// src/lib/email/invitation-delivery.ts for the delivery state machine.

/** A superseded pending invitation becomes revoked; accepted access stays intact. */
const REVOKE_IF_PENDING = sql`CASE WHEN ${projectAccessInvitations.status} = 'sent' THEN 'revoked' ELSE ${projectAccessInvitations.status} END`

/**
 * Cancels queued welcome emails whose invitation no longer matches the
 * contact's current recipient, role or status, even during a long provider
 * cooldown. Superseded pending access must not be claimed later with the
 * old recipient or role.
 */
export async function cancelObsoleteInvitationEmails(
  db: Db,
  input: {
    readonly projectId: string
    readonly contactId: string
    readonly email: string
    readonly role: string
    readonly now: string
  },
): Promise<void> {
  await db
    .update(projectAccessInvitations)
    .set({
      emailStatus: "cancelled",
      emailNextAttemptAt: null,
      status: REVOKE_IF_PENDING,
      emailClaimToken: null,
      emailClaimedAt: null,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(projectAccessInvitations.projectId, input.projectId),
        eq(projectAccessInvitations.projectContactId, input.contactId),
        inArray(projectAccessInvitations.emailStatus, ["queued", "retrying", "sending"]),
        or(
          notInArray(projectAccessInvitations.status, ["sent", "accepted"]),
          sql`${projectAccessInvitations.role} <> ${input.role}`,
          sql`lower(trim(${projectAccessInvitations.email})) <> ${input.email.trim().toLowerCase()}`,
          lte(projectAccessInvitations.workosExpiresAt, input.now),
        ),
      ),
    )
    .run()
}

/** The mailbox is busy: try a still-queued email again later. */
export async function deferInvitationEmail(db: Db, invitationId: string, nextAttemptAt: string): Promise<void> {
  await db
    .update(projectAccessInvitations)
    .set({ emailNextAttemptAt: nextAttemptAt })
    .where(and(eq(projectAccessInvitations.id, invitationId), inArray(projectAccessInvitations.emailStatus, ["queued", "retrying"])))
    .run()
}

/** Claims a queued email for sending with `token`; empty when another worker got it first. */
export async function claimInvitationEmail(
  db: Db,
  invitationId: string,
  token: string,
  now: string,
): Promise<readonly { readonly id: string }[]> {
  return db
    .update(projectAccessInvitations)
    .set({ emailStatus: "sending", emailClaimToken: token, emailClaimedAt: now, updatedAt: now })
    .where(and(eq(projectAccessInvitations.id, invitationId), inArray(projectAccessInvitations.emailStatus, ["queued", "retrying"])))
    .returning({ id: projectAccessInvitations.id })
}

/** The invitation, contact or sender's authority changed under a claimed email: cancel it. */
export async function cancelClaimedInvitationEmail(
  db: Db,
  input: { readonly invitationId: string; readonly token: string; readonly emailError: string; readonly now: string },
): Promise<void> {
  await db
    .update(projectAccessInvitations)
    .set({
      emailStatus: "cancelled",
      emailNextAttemptAt: null,
      status: REVOKE_IF_PENDING,
      emailError: input.emailError,
      updatedAt: input.now,
    })
    .where(and(eq(projectAccessInvitations.id, input.invitationId), eq(projectAccessInvitations.emailClaimToken, input.token)))
    .run()
}

/**
 * Persists the attempt count before provider I/O, so a crashed Worker never
 * blindly resends. Empty when the claim was lost or the invitation changed.
 */
export async function recordInvitationEmailAttempt(
  db: Db,
  input: { readonly invitationId: string; readonly token: string; readonly attempts: number },
): Promise<readonly { readonly id: string }[]> {
  return db
    .update(projectAccessInvitations)
    .set({ emailAttempts: input.attempts })
    .where(
      and(
        eq(projectAccessInvitations.id, input.invitationId),
        eq(projectAccessInvitations.emailClaimToken, input.token),
        eq(projectAccessInvitations.emailStatus, "sending"),
        inArray(projectAccessInvitations.status, ["sent", "accepted"]),
      ),
    )
    .returning({ id: projectAccessInvitations.id })
}

/** Records how a claimed send ended and releases the claim. */
export async function finishInvitationEmail(
  db: Db,
  input: {
    readonly invitationId: string
    readonly token: string
    readonly emailStatus: string
    readonly emailNextAttemptAt: string | null
    readonly emailError: string | null
    readonly emailProvider?: string | null
    readonly emailProviderMessageId?: string | null
    readonly emailSentAt?: string | null
    readonly updatedAt: string
  },
): Promise<void> {
  const { invitationId, token, ...result } = input
  await db
    .update(projectAccessInvitations)
    .set({ ...result, emailClaimToken: null, emailClaimedAt: null })
    .where(and(eq(projectAccessInvitations.id, invitationId), eq(projectAccessInvitations.emailClaimToken, token)))
    .run()
}

/**
 * Claims that expired mid-send may have gone out. Mark them for review
 * (never re-queue) and return them so staff can be told.
 */
export async function markStaleInvitationEmailsUnknown(
  db: Db,
  input: { readonly claimedBefore: string; readonly emailError: string; readonly now: string },
): Promise<ProjectAccessInvitation[]> {
  return db
    .update(projectAccessInvitations)
    .set({ emailStatus: "unknown", emailNextAttemptAt: null, emailError: input.emailError, updatedAt: input.now })
    .where(and(eq(projectAccessInvitations.emailStatus, "sending"), lte(projectAccessInvitations.emailClaimedAt, input.claimedBefore)))
    .returning()
}

// ---------------------------------------------------------------------------
// Account deletion requests
// ---------------------------------------------------------------------------

export async function insertAccountDeletionRequest(
  db: Db,
  row: typeof accountDeletionRequests.$inferInsert,
): Promise<void> {
  await db.insert(accountDeletionRequests).values(row).run()
}

/** Cancels the user's request while it is still pending; returns the number of rows changed. */
export async function cancelPendingAccountDeletionRequest(
  db: Db,
  input: { readonly requestId: string; readonly userId: string; readonly now: string },
): Promise<number> {
  const result = await db
    .update(accountDeletionRequests)
    .set({ status: "cancelled", cancelledAt: input.now, updatedAt: input.now })
    .where(
      and(
        eq(accountDeletionRequests.id, input.requestId),
        eq(accountDeletionRequests.userId, input.userId),
        eq(accountDeletionRequests.status, "pending"),
      ),
    )
    .run()
  return result.meta.changes ?? 0
}

/** Moves a pending request to processing; returns the number of rows changed. */
export async function startAccountDeletionRequestProcessing(
  db: Db,
  input: { readonly requestId: string; readonly startedBy: string; readonly now: string },
): Promise<number> {
  const result = await db
    .update(accountDeletionRequests)
    .set({ status: "processing", processingStartedAt: input.now, processingStartedBy: input.startedBy, updatedAt: input.now })
    .where(and(eq(accountDeletionRequests.id, input.requestId), eq(accountDeletionRequests.status, "pending")))
    .run()
  return result.meta.changes ?? 0
}

/**
 * Remove the person's data, de-identify their user row and close the
 * request in one batch, so a failure leaves nothing half-done.
 */
export async function runAccountDeletion(
  db: Db,
  input: {
    readonly requestId: string
    readonly userId: string
    readonly completedBy: string
    readonly now: string
  },
): Promise<void> {
  const { requestId, userId, completedBy, now } = input
  const deletes = PERSONAL_DATA_TABLES.map((table) => db.delete(table).where(eq(table.userId, userId)))
  // drizzle's batch wants a non-empty tuple, so a fixed statement leads.
  await db.batch([
    db.update(users).set(deidentifiedUserValues(userId, now)).where(eq(users.id, userId)),
    // This configuration uses owner_user_id rather than the common user_id key.
    // Remove shared views too; otherwise a deleted account leaves uneditable views.
    ...deleteProjectSavedViewsOwnedByStatements(db, userId),
    deleteSavedViewDefaultsForUserStatement(db, userId),
    ...deletes,
    db
      .update(accountDeletionRequests)
      .set({
        status: "completed",
        completedAt: now,
        completedBy,
        emailSnapshot: null,
        displayNameSnapshot: null,
        updatedAt: now,
      })
      .where(eq(accountDeletionRequests.id, requestId)),
  ])
}
