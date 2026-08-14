import { and, eq } from "drizzle-orm"

import { channelMembers, channels } from "@/db/schema-conversations"
import type { AuthUser } from "@/lib/auth"
import { requireOrg } from "@/lib/org-scope"
import { isInternalStaffRole } from "@/lib/user-roles"
import type { getDb } from "@/db"

export type ConversationChannelAccess = {
  readonly id: string
  readonly name: string
  readonly organizationId: string
  readonly projectId: string | null
  readonly isPrivate: boolean
  readonly audience: string
}

export function canAccessConversationChannel(input: {
  readonly hasMembership: boolean
  readonly isPrivate: boolean
  readonly audience: string
  readonly role: string
}): boolean {
  return (
    input.hasMembership ||
    (!input.isPrivate &&
      input.audience === "staff" &&
      isInternalStaffRole(input.role))
  )
}

export function isBuildertrendArchiveChannelId(channelId: string): boolean {
  return channelId.startsWith("bt-message-archive-")
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
 * Authorizes regular conversation actions. Buildertrend history channels are
 * public, staff-only channels and intentionally have no per-user membership
 * rows, so internal staff may read and continue them while external users
 * remain strictly membership-scoped.
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
    hasMembership: membership !== null,
    isPrivate: channel.isPrivate,
    audience: channel.audience,
    role: input.user.role,
  })
    ? channel
    : null
}
