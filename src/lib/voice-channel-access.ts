import { and, eq, inArray } from "drizzle-orm"
import { getDb } from "@/db"
import { projectMembers } from "@/db/schema"
import { channelMembers, channels } from "@/db/schema-conversations"
import type { AuthUser } from "@/lib/auth"
import { requireOrg } from "@/lib/org-scope"
import { can, canUseOfficeTalk } from "@/lib/permissions"
import { isInternalStaffRole } from "@/lib/user-roles"

const OFFICE_TALK_CHANNEL_ID =
  "voice-office-talk-0a72accb-1cd1-4d2d-86d7-88b0e26a8899"

export type VoiceChannelAccess = {
  readonly id: string
  readonly name: string
  readonly organizationId: string
  readonly projectId: string | null
  readonly isPrivate: boolean
  readonly audience: string
}

export async function getVoiceChannelAccess(
  db: ReturnType<typeof getDb>,
  user: AuthUser,
  channelId: string
): Promise<VoiceChannelAccess | null> {
  if (channelId === OFFICE_TALK_CHANNEL_ID && !canUseOfficeTalk(user)) {
    return null
  }
  const organizationId = requireOrg(user)
  const channel = await db
    .select({
      id: channels.id,
      name: channels.name,
      organizationId: channels.organizationId,
      projectId: channels.projectId,
      type: channels.type,
      isPrivate: channels.isPrivate,
      audience: channels.audience,
      archivedAt: channels.archivedAt,
    })
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (
    !channel ||
    channel.organizationId !== organizationId ||
    channel.type !== "voice" ||
    channel.archivedAt !== null
  ) {
    return null
  }

  const membership = await db
    .select({ id: channelMembers.id })
    .from(channelMembers)
    .where(
      and(
        eq(channelMembers.channelId, channelId),
        eq(channelMembers.userId, user.id)
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (membership || can(user, "channels", "moderate")) return channel
  if (channel.isPrivate) return null
  if (channel.audience === "organization") return channel
  if (channel.audience === "staff" && isInternalStaffRole(user.role)) {
    return channel
  }

  const projectRoleCondition =
    channel.audience === "clients"
      ? eq(projectMembers.role, "owner")
      : inArray(projectMembers.role, ["supplier", "subcontractor"])
  const projectMembership = await db
    .select({ id: projectMembers.id })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.userId, user.id),
        projectRoleCondition,
        channel.projectId
          ? eq(projectMembers.projectId, channel.projectId)
          : undefined
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)

  return projectMembership ? channel : null
}
