/**
 * Identity reads for other Core modules and auth (issue #1329). The identity
 * module owns users, organizations, their memberships and project access
 * invitations; callers outside it ask here instead of querying them.
 */
import { and, asc, eq } from "drizzle-orm"

import { organizationMembers, organizations, projectAccessInvitations, users } from "@/db/schema"
import type { Db } from "@/lib/server/action-context"
import { isInternalStaffRole } from "@/lib/user-roles"

/**
 * A still-open ("sent") invitation to this project, for staff previewing
 * someone who hasn't accepted yet. Null when it was accepted, revoked,
 * expired or is for another project.
 */
export async function openInvitationForProject(
  db: Db,
  invitationId: string,
  projectId: string,
): Promise<{ readonly id: string; readonly role: string } | null> {
  const invitation = await db
    .select({ id: projectAccessInvitations.id, role: projectAccessInvitations.role })
    .from(projectAccessInvitations)
    .where(
      and(
        eq(projectAccessInvitations.id, invitationId),
        eq(projectAccessInvitations.projectId, projectId),
        eq(projectAccessInvitations.status, "sent"),
      ),
    )
    .limit(1)
    .get()
  return invitation ?? null
}

/**
 * Every organization the person belongs to, with their role in it. Returned
 * unexecuted so sign-in can send it in the same `db.batch` as its other reads.
 */
export function organizationMembershipsQuery(db: Db, userId: string) {
  return db
    .select({
      orgId: organizations.id,
      orgName: organizations.name,
      orgType: organizations.type,
      memberRole: organizationMembers.role,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(eq(organizationMembers.userId, userId))
}

/** The company's active staff (internal roles only), by name, for staff-only pickers. */
export async function activeStaff(
  db: Db,
  organizationId: string,
): Promise<{ readonly id: string; readonly name: string }[]> {
  const rows = await db
    .select({ id: users.id, displayName: users.displayName, email: users.email, role: organizationMembers.role })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(eq(organizationMembers.organizationId, organizationId), eq(users.isActive, true)))
    .orderBy(asc(users.displayName), asc(users.email))
  return rows.filter((row) => isInternalStaffRole(row.role)).map((row) => ({ id: row.id, name: row.displayName?.trim() || row.email }))
}
