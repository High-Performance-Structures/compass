const BUILDERTREND_ORIGINAL_LINK =
  /\n*\[Open original in Buildertrend\]\(https?:\/\/(?:[^/]+\.)?buildertrend\.net\/app\/Message\/[^)]+\)\s*$/i

const COMPASS_ARCHIVE_NOTE =
  "_Buildertrend archive excerpt stored in Compass._"

export function importedConversationContent(input: {
  readonly id: string
  readonly content: string
}): string {
  const isBuildertrendArchive =
    input.id.startsWith("bt-message-") ||
    input.id.startsWith("bt-owner-history-")
  if (!isBuildertrendArchive) return input.content

  const withoutExternalLink = input.content
    .replace(BUILDERTREND_ORIGINAL_LINK, "")
    .trimEnd()
  return `${withoutExternalLink}\n\n${COMPASS_ARCHIVE_NOTE}`
}
