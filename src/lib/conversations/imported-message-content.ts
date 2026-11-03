const BUILDERTREND_ORIGINAL_LINK =
  /\n*\[Open original in Buildertrend\]\(https?:\/\/(?:[^/]+\.)?buildertrend\.net\/app\/Message\/[^)]+\)\s*$/i

const COMPASS_ARCHIVE_NOTE =
  "_Buildertrend archive excerpt stored in Compass._"

/** Import fields a conversation read returns with each message (migration 0287). */
export type ImportedMessageFields = {
  readonly sourceSystem?: string | null
  readonly importedSenderName?: string | null
}

/**
 * The text shown for a message. Rows still in a legacy staff archive get the
 * archive note; messages imported into live conversations (`sourceSystem`
 * set) read exactly like native messages, so nothing is added to them.
 */
export function importedConversationContent(input: {
  readonly id: string
  readonly content: string
  readonly sourceSystem?: string | null
}): string {
  if (input.sourceSystem) return input.content
  const isBuildertrendArchive =
    input.id.startsWith("bt-message-") ||
    input.id.startsWith("bt-owner-history-")
  if (!isBuildertrendArchive) return input.content

  const withoutExternalLink = input.content
    .replace(BUILDERTREND_ORIGINAL_LINK, "")
    .trimEnd()
  return `${withoutExternalLink}\n\n${COMPASS_ARCHIVE_NOTE}`
}

/**
 * Who a message shows as sent by. An imported message whose sender is still
 * a directory contact (no Compass account yet) is stored under the importing
 * staff account, so it shows the contact's name and never reads as the
 * viewer's own message.
 */
export function messageSenderDisplay(input: {
  readonly message: ImportedMessageFields
  readonly userId: string | null
  readonly userDisplayName: string | null
  readonly currentUserId: string | null
}): { readonly displayName: string | null; readonly senderUserId: string | null; readonly isOwnMessage: boolean } {
  const importedSenderName = input.message.importedSenderName ?? null
  if (importedSenderName !== null) {
    return { displayName: importedSenderName, senderUserId: null, isOwnMessage: false }
  }
  return {
    displayName: input.userDisplayName,
    senderUserId: input.userId,
    isOwnMessage: input.userId !== null && input.userId === input.currentUserId,
  }
}
