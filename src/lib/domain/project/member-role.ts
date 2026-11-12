import { and, eq } from "drizzle-orm"

import { projectMembers } from "@/db/schema"
import { openInvitationForProject } from "@/lib/domain/identity/reads"
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
 * The person's project roles for sign-in (`resolveSessionRole`). Returned
 * unexecuted so it can join sign-in's `db.batch`. Limited to one unordered
 * row today; issue #1329 tracks making the choice deterministic.
 */
export function projectRolesForUserQuery(db: Db, userId: string) {
  return db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(eq(projectMembers.userId, userId))
    .limit(1)
}
