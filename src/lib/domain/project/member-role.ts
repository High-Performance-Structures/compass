import { and, eq, sql } from "drizzle-orm"

import { projectMembers, projects } from "@/db/schema"
import { openInvitationForProject } from "@/lib/domain/identity/reads"
import { membershipsView, peopleView } from "@/lib/domain/identity/views"
import { invitedPreviewInvitationId } from "@/lib/invited-preview"
import type { Db } from "@/lib/server/action-context"

/**
 * The user's role on the project, or null. For staff previewing someone
 * invited who hasn't accepted, it's the role the invitation will grant.
 */
export async function projectMemberRole(
  db: Db,
  userId: string,
  projectId: string
): Promise<string | null> {
  const invitationId = invitedPreviewInvitationId(userId)
  if (invitationId) {
    const invitation = await openInvitationForProject(db, invitationId, projectId)
    return invitation?.role ?? null
  }
  const membership = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1)
    .then((rows) => rows[0] ?? null)
  return membership?.role ?? null
}

/**
 * Each distinct role the person holds on any project, for sign-in
 * (`resolveSessionRole` picks between them). Returned unexecuted so it can
 * join sign-in's `db.batch`. Distinct keeps it to a handful of rows even for
 * a vendor on hundreds of jobs.
 */
export function projectRolesForUserQuery(db: Db, userId: string) {
  return db
    .selectDistinct({ role: projectMembers.role })
    .from(projectMembers)
    .where(eq(projectMembers.userId, userId))
}

/**
 * The project's active members whose project role passes `matches` (a role
 * predicate from @/lib/user-roles, or a company setting's role list), with
 * the email notices go to. For notifying a job's team by role.
 */
export async function projectMembersWithRole(
  db: Db,
  projectId: string,
  matches: (role: string) => boolean
): Promise<readonly { readonly userId: string; readonly email: string; readonly accountRole: string }[]> {
  const people = peopleView()
  const rows = await db
    .select({ userId: projectMembers.userId, role: projectMembers.role, email: people.email, googleEmail: people.googleEmail, accountRole: people.role })
    .from(projectMembers)
    .innerJoin(people, eq(people.id, projectMembers.userId))
    .where(and(eq(projectMembers.projectId, projectId), eq(people.isActive, true)))
  return rows
    .filter((row) => matches(row.role))
    .map((row) => ({ userId: row.userId, email: row.googleEmail?.trim() || row.email, accountRole: row.accountRole }))
}

/**
 * The active company user named as the job's project manager on the project
 * record (a name, not a membership), or null when none matches exactly one.
 */
export async function namedProjectManager(
  db: Db,
  projectId: string
): Promise<{ readonly userId: string; readonly email: string; readonly accountRole: string } | null> {
  const project = await db
    .select({ name: projects.projectManager, organizationId: projects.organizationId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get()
  const name = project?.name?.trim()
  if (!name || !project?.organizationId) return null
  const people = peopleView()
  const memberships = membershipsView()
  const matches = await db
    // The role the person holds in the job's company decides whether they are its staff.
    .select({ userId: people.id, email: people.email, googleEmail: people.googleEmail, accountRole: memberships.role })
    .from(people)
    .innerJoin(memberships, and(eq(memberships.userId, people.id), eq(memberships.organizationId, project.organizationId)))
    .where(and(eq(people.isActive, true), sql`lower(trim(${people.displayName})) = lower(${name})`))
    .limit(2)
  const only = matches.length === 1 ? matches[0] : undefined
  return only ? { userId: only.userId, email: only.googleEmail?.trim() || only.email, accountRole: only.accountRole } : null
}
