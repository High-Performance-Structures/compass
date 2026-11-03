import { and, eq } from "drizzle-orm"

import { internalContacts, organizationMembers, projectAccessInvitations, projectContacts, users } from "@/db/schema"
import type { Db } from "@/lib/server/action-context"

import { normalizeEmailKey } from "./rules"

type Scope = { readonly db: Db; readonly organizationId: string; readonly projectId: string }

export type ProjectContactRemoval = {
  readonly contactId: string
  /** Compass users this contact may have given project access to. */
  readonly memberUserIds: readonly string[]
  readonly organizationEmailByUserId: ReadonlyMap<string, string>
}

/** The active contact being removed and the users it may have granted access to. */
export async function loadProjectContactRemoval(
  { db, organizationId, projectId }: Scope,
  contactId: string
): Promise<ProjectContactRemoval | null> {
  const [contact] = await db
    .select({
      id: projectContacts.id,
      sourceEntityType: projectContacts.sourceEntityType,
      sourceEntityId: projectContacts.sourceEntityId,
      internalContactId: projectContacts.internalContactId,
      email: projectContacts.email,
    })
    .from(projectContacts)
    .where(and(eq(projectContacts.id, contactId), eq(projectContacts.projectId, projectId), eq(projectContacts.active, true)))
    .limit(1)
  if (!contact) return null

  const [invitationRows, linkedPerson, organizationUsers] = await Promise.all([
    db
      .select({ acceptedBy: projectAccessInvitations.acceptedBy })
      .from(projectAccessInvitations)
      .where(and(eq(projectAccessInvitations.projectId, projectId), eq(projectAccessInvitations.projectContactId, contactId))),
    contact.internalContactId
      ? db
          .select({ userId: internalContacts.userId })
          .from(internalContacts)
          .where(and(eq(internalContacts.id, contact.internalContactId), eq(internalContacts.organizationId, organizationId)))
          .get()
      : undefined,
    db
      .select({ id: users.id, email: users.email })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(eq(organizationMembers.organizationId, organizationId)),
  ])
  const memberUserIds = new Set(
    invitationRows.map((invitation) => invitation.acceptedBy).filter((acceptedBy): acceptedBy is string => acceptedBy !== null)
  )
  if (contact.sourceEntityType === "user" && contact.sourceEntityId) memberUserIds.add(contact.sourceEntityId)
  if (linkedPerson?.userId) memberUserIds.add(linkedPerson.userId)
  if (contact.email) {
    const contactEmail = normalizeEmailKey(contact.email)
    for (const organizationUser of organizationUsers) {
      if (normalizeEmailKey(organizationUser.email) === contactEmail) memberUserIds.add(organizationUser.id)
    }
  }
  return {
    contactId: contact.id,
    memberUserIds: Array.from(memberUserIds),
    organizationEmailByUserId: new Map(organizationUsers.map((user) => [user.id, normalizeEmailKey(user.email)])),
  }
}

/**
 * One person can have several project-contact roles. After a removal, keep
 * project access for anyone another active contact or accepted invitation
 * still grants it to; return the rest.
 */
export async function removableProjectMemberIds(
  { db, organizationId, projectId }: Scope,
  removal: ProjectContactRemoval
): Promise<readonly string[]> {
  if (removal.memberUserIds.length === 0) return []
  const [remainingContacts, remainingInvitations] = await Promise.all([
    db
      .select({
        sourceEntityType: projectContacts.sourceEntityType,
        sourceEntityId: projectContacts.sourceEntityId,
        linkedUserId: internalContacts.userId,
        email: projectContacts.email,
      })
      .from(projectContacts)
      .leftJoin(
        internalContacts,
        and(eq(projectContacts.internalContactId, internalContacts.id), eq(internalContacts.organizationId, organizationId))
      )
      .where(and(eq(projectContacts.projectId, projectId), eq(projectContacts.active, true))),
    db
      .select({
        acceptedBy: projectAccessInvitations.acceptedBy,
        email: projectAccessInvitations.email,
        status: projectAccessInvitations.status,
      })
      .from(projectAccessInvitations)
      .where(eq(projectAccessInvitations.projectId, projectId)),
  ])
  const remainingUserIds = new Set(
    remainingContacts.flatMap((contact) => [
      ...(contact.sourceEntityType === "user" && contact.sourceEntityId ? [contact.sourceEntityId] : []),
      ...(contact.linkedUserId ? [contact.linkedUserId] : []),
    ])
  )
  const remainingEmails = new Set(
    remainingContacts.map((contact) => normalizeEmailKey(contact.email)).filter((email) => email.length > 0)
  )
  for (const invitation of remainingInvitations) {
    if (invitation.status !== "accepted") continue
    if (invitation.acceptedBy) remainingUserIds.add(invitation.acceptedBy)
    const invitationEmail = normalizeEmailKey(invitation.email)
    if (invitationEmail) remainingEmails.add(invitationEmail)
  }
  return removal.memberUserIds.filter((userId) => {
    const email = removal.organizationEmailByUserId.get(userId)
    return !remainingUserIds.has(userId) && (!email || !remainingEmails.has(email))
  })
}
