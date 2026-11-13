import { and, eq } from "drizzle-orm"

import { projectMembers } from "@/db/schema"
import { openInvitationForProject } from "@/lib/domain/identity/reads"
import { peopleView } from "@/lib/domain/identity/views"
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
): Promise<readonly { readonly userId: string; readonly email: string }[]> {
  const people = peopleView()
  const rows = await db
    .select({ userId: projectMembers.userId, role: projectMembers.role, email: people.email, googleEmail: people.googleEmail })
    .from(projectMembers)
    .innerJoin(people, eq(people.id, projectMembers.userId))
    .where(and(eq(projectMembers.projectId, projectId), eq(people.isActive, true)))
  return rows
    .filter((row) => matches(row.role))
    .map((row) => ({ userId: row.userId, email: row.googleEmail?.trim() || row.email }))
}
