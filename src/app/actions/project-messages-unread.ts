"use server"

import { correspondenceContext } from "@/lib/correspondence/access"
import { countUnreadCorrespondence } from "@/lib/correspondence/read"
import { countProjectConversationsUnread } from "@/lib/domain/conversations/project-conversations"
import { isInternalStaffRole } from "@/lib/user-roles"

/**
 * The job's Messages badge: unread email conversations in the viewer's inbox
 * plus unread job conversations they are in (imported threads count once, as
 * conversations). correspondenceContext checks the viewer may open the job and
 * supplies the job's own organization for both counts.
 */
export async function getProjectMessagesUnreadCount(projectId: string): Promise<number> {
  try {
    const ctx = await correspondenceContext(projectId, "read")
    const [emails, conversations] = await Promise.all([
      countUnreadCorrespondence(ctx),
      countProjectConversationsUnread({
        db: ctx.db,
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        userId: ctx.user.id,
        viewerIsInternal: ctx.workspace === "staff" && isInternalStaffRole(ctx.user.role),
      }),
    ])
    return emails + conversations
  } catch (error) {
    // No access to the job is a normal 0; log only real failures so a wrong 0 is visible.
    const message = error instanceof Error ? error.message : String(error)
    if (/SQL|sqlite|D1|database|query|subrequest/i.test(message)) console.error("project_messages_unread_count_failed", message)
    return 0
  }
}
