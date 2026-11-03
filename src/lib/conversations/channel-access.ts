import { isInternalStaffRole } from "@/lib/user-roles"

export type ConversationChannelAccess = {
  readonly id: string
  readonly name: string
  readonly organizationId: string
  readonly projectId: string | null
  readonly isPrivate: boolean
  readonly audience: string
}

export function isBuildertrendArchiveChannelId(channelId: string): boolean {
  return channelId.startsWith("bt-message-archive-")
}

/** Where an imported conversation came from, and its project's staff-only switch. */
export type ImportedConversationAccess = {
  readonly sourceSystem: string
  readonly projectStaffOnly: boolean
}

/** External audiences an imported conversation may be shared with. */
const IMPORTED_EXTERNAL_AUDIENCES: ReadonlySet<string> = new Set(["clients", "sub_vendors"])

/**
 * Imported conversations (migration 0287) behave like project conversations:
 * every internal staff member may open them, as they could the old staff
 * archive, and an owner or vendor needs a membership in a client or vendor
 * conversation. A project marked staff-only (for example under a legal hold)
 * closes them to everyone outside the company, even with a stale membership.
 */
export function canAccessImportedConversation(input: {
  readonly hasMembership: boolean
  readonly audience: string
  readonly role: string
  readonly imported: ImportedConversationAccess
}): boolean {
  if (isInternalStaffRole(input.role)) return true
  if (input.imported.projectStaffOnly) return false
  return input.hasMembership && IMPORTED_EXTERNAL_AUDIENCES.has(input.audience)
}

/** The import columns of a channel row, as the access check needs them. */
export function importedConversationAccess(input: {
  readonly sourceSystem: string | null
  readonly projectStaffOnly: boolean | null
}): ImportedConversationAccess | null {
  if (input.sourceSystem === null) return null
  return { sourceSystem: input.sourceSystem, projectStaffOnly: input.projectStaffOnly === true }
}

export function canAccessConversationChannel(input: {
  readonly channelId: string
  readonly hasMembership: boolean
  readonly isActive: boolean
  readonly isPrivate: boolean
  readonly audience: string
  readonly role: string
  /** Set when the channel was created from an outside system's thread. */
  readonly imported?: ImportedConversationAccess | null
}): boolean {
  if (!input.isActive) return false

  if (input.imported) {
    return canAccessImportedConversation({
      hasMembership: input.hasMembership,
      audience: input.audience,
      role: input.role,
      imported: input.imported,
    })
  }

  if (isBuildertrendArchiveChannelId(input.channelId)) {
    return (
      !input.isPrivate &&
      input.audience === "staff" &&
      isInternalStaffRole(input.role)
    )
  }
  return input.hasMembership
}

export function canCreateConversationMessage(input: {
  readonly channelId: string
  readonly threadId?: string
}): boolean {
  return !isBuildertrendArchiveChannelId(input.channelId) || Boolean(input.threadId)
}

export function areArchiveMentionTypesAllowed(input: {
  readonly channelId: string
  readonly mentionTypes: readonly string[]
}): boolean {
  return (
    !isBuildertrendArchiveChannelId(input.channelId) ||
    input.mentionTypes.every((mentionType) => mentionType === "user")
  )
}

export function areArchiveUserMentionsInternal(input: {
  readonly channelId: string
  readonly mentionedUserIds: readonly string[]
  readonly internalUserIds: ReadonlySet<string>
}): boolean {
  return (
    !isBuildertrendArchiveChannelId(input.channelId) ||
    input.mentionedUserIds.every((userId) => input.internalUserIds.has(userId))
  )
}

export function isReplyInConversationChannel(input: {
  readonly channelId: string
  readonly parentChannelId: string | null
  readonly parentThreadId: string | null
}): boolean {
  return (
    input.parentChannelId === input.channelId &&
    input.parentThreadId === null
  )
}
