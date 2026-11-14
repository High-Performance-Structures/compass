/**
 * Identity reads for other Core modules and auth (issue #1329). The identity
 * module owns users, organizations, their memberships and project access
 * invitations; callers outside it ask here instead of querying them.
 */
import { and, asc, eq } from "drizzle-orm"

import { organizationMembers, organizations, projectAccessInvitations, users } from "@/db/schema"
import type { Db } from "@/lib/server/action-context"
import { isAdminRole, isInternalStaffRole } from "@/lib/user-roles"

import { notDevelopmentAccount } from "./development-accounts"

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

/** The company's active staff (internal roles only, no development accounts), by name, for staff-only pickers. */
export async function activeStaff(
  db: Db,
  organizationId: string,
): Promise<{ readonly id: string; readonly name: string }[]> {
  const rows = await db
    .select({ id: users.id, displayName: users.displayName, email: users.email, role: organizationMembers.role })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(eq(organizationMembers.organizationId, organizationId), eq(users.isActive, true), notDevelopmentAccount(organizationMembers)))
    .orderBy(asc(users.displayName), asc(users.email))
  return rows.filter((row) => isInternalStaffRole(row.role)).map((row) => ({ id: row.id, name: row.displayName?.trim() || row.email }))
}

/** The company's first active administrator (longest a member), by name: a last-resort assignee. */
export async function firstActiveAdmin(
  db: Db,
  organizationId: string,
): Promise<{ readonly id: string; readonly name: string } | null> {
  const rows = await db
    .select({ id: users.id, displayName: users.displayName, email: users.email, role: organizationMembers.role })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(eq(organizationMembers.organizationId, organizationId), eq(users.isActive, true)))
    .orderBy(asc(organizationMembers.joinedAt), asc(users.id))
  const admin = rows.find((row) => isAdminRole(row.role))
  return admin ? { id: admin.id, name: admin.displayName?.trim() || admin.email } : null
}

/**
 * Active staff (internal roles) of every active internal company, with their
 * company role and email: for company-wide system notices such as the daily
 * data health check. The caller picks admins or the people its settings name.
 */
export async function activeInternalCompanyStaff(
  db: Db,
): Promise<readonly { readonly organizationId: string; readonly userId: string; readonly email: string; readonly role: string }[]> {
  const rows = await db
    .select({ organizationId: organizationMembers.organizationId, userId: users.id, email: users.email, role: organizationMembers.role })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(and(eq(organizations.type, "internal"), eq(organizations.isActive, true), eq(users.isActive, true)))
  return rows.filter((row) => isInternalStaffRole(row.role))
}

// ---- Raw D1 reads, for callers that batch plain prepared statements

/**
 * Active members of the company when it is an active internal company, with
 * their company role (not the account role). The caller applies its own role
 * and permission rule.
 */
export async function activeInternalCompanyMembers(
  database: D1Database,
  organizationId: string,
): Promise<readonly { readonly id: string; readonly role: string }[]> {
  const members = await database.prepare(`SELECT u.id, m.role
    FROM users u JOIN organization_members m ON m.user_id = u.id
    JOIN organizations o ON o.id = m.organization_id
    WHERE m.organization_id = ? AND o.type = 'internal' AND o.is_active = 1 AND u.is_active = 1`)
    .bind(organizationId).all<{ id: string; role: string }>()
  return members.results
}

/**
 * Active accounts that accepted an invitation on one of these project contacts
 * and are a client member of the company: the sign-ins those contacts carry.
 */
export async function acceptedClientSignIns(
  database: D1Database,
  organizationId: string,
  projectContactIds: readonly string[],
): Promise<readonly string[]> {
  const userIds = new Set<string>()
  // D1 allows 100 bound values per statement.
  for (let start = 0; start < projectContactIds.length; start += 90) {
    const chunk = projectContactIds.slice(start, start + 90)
    const result = await database.prepare(`SELECT DISTINCT i.accepted_by AS user_id FROM project_access_invitations i
        JOIN users u ON u.id = i.accepted_by
        JOIN organization_members om ON om.user_id = i.accepted_by AND om.organization_id = ? AND om.role = 'client'
      WHERE i.status = 'accepted' AND u.is_active = 1 AND i.project_contact_id IN (${chunk.map(() => "?").join(", ")})`)
      .bind(organizationId, ...chunk).all<{ user_id: string | null }>()
    for (const row of result.results) if (row.user_id) userIds.add(row.user_id)
  }
  return [...userIds]
}

// ---- SQL text for generated scripts (`quotedId` is an already-quoted SQL literal)

/** How many companies have this id: 0 or 1. */
export function companyCountSql(quotedId: string): string {
  return `(SELECT COUNT(*) FROM organizations WHERE id = ${quotedId})`
}

/** True when a company with this id exists. */
export function companyExistsSql(quotedId: string): string {
  return `EXISTS (
  SELECT 1 FROM organizations WHERE id = ${quotedId}
)`
}
