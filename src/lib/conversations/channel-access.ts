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

export function canAccessConversationChannel(input: {
  readonly channelId: string
  readonly hasMembership: boolean
  readonly isActive: boolean
  readonly isPrivate: boolean
  readonly audience: string
  readonly role: string
}): boolean {
  if (!input.isActive) return false

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
