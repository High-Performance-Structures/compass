import { and, desc, eq, sql } from "drizzle-orm"

import type { getDb } from "@/db"
import {
  projectContacts,
} from "@/db/schema"
import { invitationsView } from "@/lib/domain/identity/views"
import { resolvedContactColumns, withContactDirectory } from "@/lib/domain/contacts/resolved-columns"

const invitations = invitationsView()

export type ProjectAudienceViewerContact = {
  readonly id: string
  readonly contactType: string
  readonly displayName: string
  readonly companyName: string | null
  readonly email: string | null
  /** The vendor company this contact belongs to, when linked. */
  readonly vendorId: string | null
}

const VIEWER_CONTACT_SELECTION = {
  id: projectContacts.id,
  contactType: projectContacts.contactType,
  displayName: resolvedContactColumns.displayName,
  companyName: resolvedContactColumns.companyName,
  email: resolvedContactColumns.email,
  vendorId: projectContacts.vendorId,
}

export async function getProjectAudienceViewerContact(
  db: ReturnType<typeof getDb>,
  projectId: string,
  viewer: { readonly id: string; readonly email: string }
): Promise<ProjectAudienceViewerContact | null> {
  const acceptedInvitation = await db
    .select({ projectContactId: invitations.projectContactId })
    .from(invitations)
    .where(
      and(
        eq(invitations.projectId, projectId),
        eq(invitations.acceptedBy, viewer.id),
        eq(invitations.status, "accepted")
      )
    )
    .orderBy(desc(invitations.acceptedAt))
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (acceptedInvitation?.projectContactId) {
    const invitedContact = await withContactDirectory(db
      .select(VIEWER_CONTACT_SELECTION)
      .from(projectContacts)
      .where(
        and(
          eq(projectContacts.id, acceptedInvitation.projectContactId),
          eq(projectContacts.projectId, projectId),
          eq(projectContacts.active, true)
        )
      )
      .limit(1).$dynamic())
      .then((rows) => rows[0] ?? null)
    if (invitedContact) return invitedContact
  }

  const normalizedEmail = viewer.email.trim().toLowerCase()
  if (!normalizedEmail) return null

  return withContactDirectory(db
    .select(VIEWER_CONTACT_SELECTION)
    .from(projectContacts)
    .where(
      and(
        eq(projectContacts.projectId, projectId),
        eq(projectContacts.active, true),
        sql`lower(${resolvedContactColumns.email}) = ${normalizedEmail}`
      )
    )
    .limit(1).$dynamic())
    .then((rows) => rows[0] ?? null)
}
