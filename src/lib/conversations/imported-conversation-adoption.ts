import { and, eq, sql } from "drizzle-orm"

import { projects } from "@/db/schema"
import { channels } from "@/db/schema-conversations"
import {
  adoptImportedSenderMessages,
  insertChannelMembers,
  insertReadStates,
} from "@/lib/domain/conversations/store"
import type { Db } from "@/lib/server/action-context"

/*
 * Owners and vendors can be part of imported (e.g. Buildertrend) conversations
 * before they have a Compass account: the importer records them as directory
 * contacts on the thread's participant rows. When one of them is given
 * access, this joins them to those conversations and moves the messages they
 * sent onto their new account, so the threads are simply there when they log
 * in. Nothing is sent: no notification, no email, and nothing is unread.
 */

/** Imported conversations an external audience member may join. */
function importedChannelAudienceFor(audience: "owner" | "sub_vendor"): "clients" | "sub_vendors" {
  return audience === "owner" ? "clients" : "sub_vendors"
}

export async function adoptImportedConversationsForContact(input: {
  readonly db: Db
  readonly projectId: string
  readonly projectContactId: string
  readonly userId: string
  readonly audience: "owner" | "sub_vendor"
  readonly now: string
}): Promise<readonly string[]> {
  const project = await input.db
    .select({ staffOnly: projects.importedConversationsStaffOnly })
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .get()
  // A staff-only project (for example under a legal hold) never adds outside people.
  if (!project || project.staffOnly) return []

  const rows = await input.db
    .select({ id: channels.id })
    .from(channels)
    .where(
      and(
        eq(channels.projectId, input.projectId),
        eq(channels.audience, importedChannelAudienceFor(input.audience)),
        sql`${channels.sourceSystem} IS NOT NULL`,
        sql`${channels.archivedAt} IS NULL`,
        // The importer records thread participants as `<source>_message_thread` rows.
        sql`EXISTS (SELECT 1 FROM project_source_record_participants p
          WHERE p.project_id = ${input.projectId}
            AND p.source_record_type = ${channels.sourceSystem} || '_message_thread'
            AND p.source_record_id = ${channels.sourceThreadId}
            AND p.project_contact_id = ${input.projectContactId}
            AND p.active = 1)`
      )
    )
  const channelIds = rows.map((row) => row.id)

  await insertChannelMembers(
    input.db,
    channelIds.map((channelId) => ({
      id: crypto.randomUUID(),
      channelId,
      userId: input.userId,
      role: "member",
      notifyLevel: "all",
      joinedAt: input.now,
    })),
    { ignoreConflict: true }
  )
  await insertReadStates(
    input.db,
    channelIds.map((channelId) => ({
      id: crypto.randomUUID(),
      userId: input.userId,
      channelId,
      lastReadMessageId: null,
      lastReadAt: input.now,
      unreadCount: 0,
    })),
    { ignoreConflict: true }
  )
  await adoptImportedSenderMessages(input.db, {
    projectId: input.projectId,
    projectContactId: input.projectContactId,
    userId: input.userId,
  })
  return channelIds
}
