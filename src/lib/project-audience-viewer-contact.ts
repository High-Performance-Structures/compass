import { and, desc, eq, sql } from "drizzle-orm"

import type { getDb } from "@/db"
import {
  projectAccessInvitations,
  projectContacts,
} from "@/db/schema"

export type ProjectAudienceViewerContact = {
  readonly id: string
  readonly contactType: string
  readonly displayName: string
  readonly companyName: string | null
  readonly email: string | null
}

const VIEWER_CONTACT_SELECTION = {
  id: projectContacts.id,
  contactType: projectContacts.contactType,
  displayName: projectContacts.displayName,
  companyName: projectContacts.companyName,
  email: projectContacts.email,
}

export async function getProjectAudienceViewerContact(
  db: ReturnType<typeof getDb>,
  projectId: string,
  viewer: { readonly id: string; readonly email: string }
): Promise<ProjectAudienceViewerContact | null> {
  const acceptedInvitation = await db
    .select({ projectContactId: projectAccessInvitations.projectContactId })
    .from(projectAccessInvitations)
    .where(
      and(
        eq(projectAccessInvitations.projectId, projectId),
        eq(projectAccessInvitations.acceptedBy, viewer.id),
        eq(projectAccessInvitations.status, "accepted")
      )
    )
    .orderBy(desc(projectAccessInvitations.acceptedAt))
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (acceptedInvitation?.projectContactId) {
    const invitedContact = await db
      .select(VIEWER_CONTACT_SELECTION)
      .from(projectContacts)
      .where(
        and(
          eq(projectContacts.id, acceptedInvitation.projectContactId),
          eq(projectContacts.projectId, projectId),
          eq(projectContacts.active, true)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
    if (invitedContact) return invitedContact
  }

  const normalizedEmail = viewer.email.trim().toLowerCase()
  if (!normalizedEmail) return null

  return db
    .select(VIEWER_CONTACT_SELECTION)
    .from(projectContacts)
    .where(
      and(
        eq(projectContacts.projectId, projectId),
        eq(projectContacts.active, true),
        sql`lower(trim(${projectContacts.email})) = ${normalizedEmail}`
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)
}
