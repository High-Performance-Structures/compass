import { and, eq } from "drizzle-orm"

import type { getDb } from "@/db"
import { projectAccessInvitations, projectMembers } from "@/db/schema"
import { invitedPreviewInvitationId } from "@/lib/invited-preview"

type Db = ReturnType<typeof getDb>

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
    const invitation = await db
      .select({ role: projectAccessInvitations.role })
      .from(projectAccessInvitations)
      .where(
        and(
          eq(projectAccessInvitations.id, invitationId),
          eq(projectAccessInvitations.projectId, projectId),
          eq(projectAccessInvitations.status, "sent")
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
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
