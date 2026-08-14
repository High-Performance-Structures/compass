import { and, eq } from "drizzle-orm"

import { channelMembers, channels } from "@/db/schema-conversations"
import type { getDb } from "@/db"
import type { AuthUser } from "@/lib/auth"
import { requireOrg } from "@/lib/org-scope"
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
  readonly isPrivate: boolean
  readonly audience: string
  readonly role: string
}): boolean {
  return (
    input.hasMembership ||
    (isBuildertrendArchiveChannelId(input.channelId) &&
      !input.isPrivate &&
      input.audience === "staff" &&
      isInternalStaffRole(input.role))
  )
}

export function canCreateConversationMessage(input: {
  readonly channelId: string
  readonly threadId?: string
}): boolean {
  return !isBuildertrendArchiveChannelId(input.channelId) || Boolean(input.threadId)
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

/**
 * Buildertrend history imports are public staff-only channels with no per-user
 * membership rows. Only that source namespace permits internal staff access
 * without membership; every other conversation remains membership-scoped.
 */
export async function getConversationChannelAccess(input: {
  readonly db: ReturnType<typeof getDb>
  readonly user: AuthUser
  readonly channelId: string
}): Promise<ConversationChannelAccess | null> {
  const channel = await input.db
    .select({
      id: channels.id,
      name: channels.name,
      organizationId: channels.organizationId,
      projectId: channels.projectId,
      isPrivate: channels.isPrivate,
      audience: channels.audience,
    })
    .from(channels)
    .where(eq(channels.id, input.channelId))
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (!channel || channel.organizationId !== requireOrg(input.user)) {
    return null
  }

  const membership = await input.db
    .select({ id: channelMembers.id })
    .from(channelMembers)
    .where(
      and(
        eq(channelMembers.channelId, input.channelId),
        eq(channelMembers.userId, input.user.id)
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)

  return canAccessConversationChannel({
    channelId: channel.id,
    hasMembership: membership !== null,
    isPrivate: channel.isPrivate,
    audience: channel.audience,
    role: input.user.role,
  })
    ? channel
    : null
}
