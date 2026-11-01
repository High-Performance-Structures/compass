import { sql } from "drizzle-orm"

import { messages } from "@/db/schema-conversations"

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
  importedSenderName: sql<string | null>`(SELECT pc.display_name FROM project_contacts pc WHERE pc.id = ${messages.importedSenderContactId})`,
}

/**
 * Imported messages never notify anyone: they were delivered in the source
 * system when they were sent. Native replies in the same conversation do.
 */
export function shouldNotifyForMessage(message: { readonly sourceSystem: string | null }): boolean {
  return message.sourceSystem === null
}
