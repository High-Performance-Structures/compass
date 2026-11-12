import { and, asc, eq, or } from "drizzle-orm"

import type { getDb } from "@/db"
import {
  projectContacts,
  internalContacts,
} from "@/db/schema"
import { membershipsView, peopleView } from "@/lib/domain/identity/views"
import type { ProjectAudience } from "@/lib/project-audience-access"
import { isVisibleAudienceTeamMember } from "@/lib/project-audience-team"
import { resolvedContactColumns, withContactDirectory } from "@/lib/domain/contacts/resolved-columns"

const memberships = membershipsView()
const people = peopleView()

export type ProjectAudienceStaffMember = {
  readonly contactId: string
  readonly userId: string
  readonly displayName: string
  readonly email: string
  readonly companyName: string | null
  readonly role: string | null
  readonly trade: string | null
  readonly csiDivision: string | null
  readonly csiDivisionName: string | null
  readonly phone: string | null
  readonly primaryContact: boolean
}

/**
 * Returns only linked internal contacts explicitly selected for this audience.
 * The project-contact visibility checkboxes are the source of truth for portal
 * team lists and communication recipients.
 */
export async function getProjectAudienceStaff(
  db: ReturnType<typeof getDb>,
  input: {
    readonly projectId: string
    readonly organizationId: string
    readonly audience: ProjectAudience
  }
): Promise<readonly ProjectAudienceStaffMember[]> {
  const audienceVisibility =
    input.audience === "owner"
      ? eq(projectContacts.ownerPortalVisible, true)
      : eq(projectContacts.subVendorPortalVisible, true)
  const rows = await withContactDirectory(db
    .select({
      contactId: projectContacts.id,
      userId: people.id,
      contactDisplayName: resolvedContactColumns.displayName,
      userDisplayName: people.displayName,
      email: people.email,
      companyName: resolvedContactColumns.companyName,
      contactRole: projectContacts.role,
      organizationRole: memberships.role,
      trade: projectContacts.trade,
      csiDivision: projectContacts.csiDivision,
      csiDivisionName: projectContacts.csiDivisionName,
      phone: resolvedContactColumns.phone,
      primaryContact: projectContacts.primaryContact,
    })
    .from(projectContacts)
    .leftJoin(
      internalContacts,
      and(
        eq(projectContacts.internalContactId, internalContacts.id),
        eq(internalContacts.organizationId, input.organizationId),
        eq(internalContacts.active, true)
      )
    )
    .innerJoin(
      people,
      or(
        and(
          eq(projectContacts.sourceEntityType, "user"),
          eq(projectContacts.sourceEntityId, people.id)
        ),
        eq(internalContacts.userId, people.id)
      )
    )
    .innerJoin(
      memberships,
      and(
        eq(memberships.userId, people.id),
        eq(memberships.organizationId, input.organizationId)
      )
    )
    .where(
      and(
        eq(projectContacts.projectId, input.projectId),
        eq(projectContacts.contactType, "internal"),
        eq(projectContacts.active, true),
        eq(people.isActive, true),
        audienceVisibility
      )
    )
    .orderBy(
      asc(projectContacts.sortOrder),
      asc(resolvedContactColumns.displayName),
      asc(people.email)
    ).$dynamic(), input.organizationId)

  return rows
    .filter((row) =>
      isVisibleAudienceTeamMember({
        userId: row.userId,
        email: row.email,
        role: row.organizationRole,
      })
    )
    .map((row) => ({
      contactId: row.contactId,
      userId: row.userId,
      displayName:
        row.contactDisplayName.trim() || row.userDisplayName?.trim() || row.email,
      email: row.email,
      companyName: row.companyName,
      role: row.contactRole ?? row.organizationRole,
      trade: row.trade,
      csiDivision: row.csiDivision,
      csiDivisionName: row.csiDivisionName,
      phone: row.phone,
      primaryContact: row.primaryContact,
    }))
}
