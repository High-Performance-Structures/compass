import { sql } from "drizzle-orm"

import { users } from "@/db/schema"
import { messages } from "@/db/schema-conversations"
import { archivedAwareNameSql } from "@/lib/archived-person-sql"
import { projectContactPersonStatusSql } from "@/lib/domain/contacts/person-status"
import { resolvedContactValueOf } from "@/lib/domain/contacts/resolved-columns"

/*
 * Messages imported from an outside system (Buildertrend today) live in
 * ordinary project conversations (migration 0287). They read like any other
 * message; the only differences are a small source tag and, while the
 * original sender has no Compass account yet, the sender's directory name.
 * See docs/plans/bt-messages-live-conversations.md.
 */

/** Extra message columns every conversation read selects alongside the message. */
export const importedMessageColumns = {
  sourceSystem: messages.sourceSystem,
  // The sender's directory name (resolved from the job contact's directory
  // record, never its copied name), else the sender exactly as the source showed
  // it when they could not be matched (0290).
  // An archived sender (removed from Contacts, or former staff) reads
  // "Archived user – Name".
  importedSenderName: sql<string | null>`COALESCE((
    SELECT ${archivedAwareNameSql(resolvedContactValueOf("displayName"), sql`${projectContactPersonStatusSql()} = 'archived_person'`)}
    FROM project_contacts WHERE project_contacts.id = ${messages.importedSenderContactId}
  ), ${messages.sourceSenderLabelSnapshot})`,
}

/**
 * A native message sender's name, for the `user` object of message reads
 * (joined on `users`). An inactive account reads "Archived user – Name".
 */
export const messageSenderDisplayName = archivedAwareNameSql(users.displayName, sql`${users.isActive} = 0`)

/**
 * Imported messages never notify anyone: they were delivered in the source
 * system when they were sent. Native replies in the same conversation do.
 */
export function shouldNotifyForMessage(message: { readonly sourceSystem: string | null }): boolean {
  return message.sourceSystem === null
}
