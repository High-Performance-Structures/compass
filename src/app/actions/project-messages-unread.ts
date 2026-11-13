"use server"

import { correspondenceContext } from "@/lib/correspondence/access"
import { listCorrespondence } from "@/lib/correspondence/read"
import { readProjectConversationUnreadCount } from "@/lib/domain/conversations/project-conversations"

/**
 * The job's Messages badge: unread emails in the viewer's inbox plus unread
 * conversations they are in. Imported threads count once, as conversations.
 */
export async function getProjectMessagesUnreadCount(projectId: string): Promise<number> {
  const [emails, conversations] = await Promise.all([
    correspondenceContext(projectId, "read")
      .then((ctx) => listCorrespondence(ctx))
      .then((rows) => rows.filter((row) => row.unread && !row.archived).length)
      .catch(() => 0),
    readProjectConversationUnreadCount(projectId).catch(() => 0),
  ])
  return emails + conversations
}
