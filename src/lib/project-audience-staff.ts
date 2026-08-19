import { and, asc, eq } from "drizzle-orm"

import type { getDb } from "@/db"
import {
  organizationMembers,
  projectContacts,
  users,
} from "@/db/schema"
import type { ProjectAudience } from "@/lib/project-audience-access"
import { isVisibleAudienceTeamMember } from "@/lib/project-audience-team"

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
  const rows = await db
    .select({
      contactId: projectContacts.id,
      userId: users.id,
      contactDisplayName: projectContacts.displayName,
      userDisplayName: users.displayName,
      email: users.email,
      companyName: projectContacts.companyName,
      contactRole: projectContacts.role,
      organizationRole: organizationMembers.role,
      trade: projectContacts.trade,
      csiDivision: projectContacts.csiDivision,
      csiDivisionName: projectContacts.csiDivisionName,
      phone: projectContacts.phone,
      primaryContact: projectContacts.primaryContact,
    })
    .from(projectContacts)
    .innerJoin(
      users,
      and(
        eq(projectContacts.sourceEntityType, "user"),
        eq(projectContacts.sourceEntityId, users.id)
      )
    )
    .innerJoin(
      organizationMembers,
      and(
        eq(organizationMembers.userId, users.id),
        eq(organizationMembers.organizationId, input.organizationId)
      )
    )
    .where(
      and(
        eq(projectContacts.projectId, input.projectId),
        eq(projectContacts.contactType, "internal"),
        eq(projectContacts.active, true),
        eq(users.isActive, true),
        audienceVisibility
      )
    )
    .orderBy(
      asc(projectContacts.sortOrder),
      asc(projectContacts.displayName),
      asc(users.email)
    )

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
