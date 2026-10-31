import { and, eq, sql } from "drizzle-orm"

import { getDb } from "@/db"
import { channelMembers, channelReadState, channels } from "@/db/schema-conversations"
import { getCurrentUser } from "@/lib/auth"
import { isBuildertrendArchiveChannelId } from "@/lib/conversations/channel-access"
import { conversationRequestViewer } from "@/lib/conversations/preview-viewer"
import { getCloudflareContext } from "@/lib/db"
import { requireOrg } from "@/lib/org-scope"
import { getProjectAudienceRequestScope } from "@/lib/project-audience-request-server"
import { isInternalStaffRole } from "@/lib/user-roles"

/*
 * Channel reads shared by the conversation actions and the screens that embed
 * conversations (field mode, the project conversation panel). Visibility is
 * the viewer's organization, project audience scope and channel membership.
 */

/** The channels the signed-in viewer can see, in sidebar order. */
export async function readVisibleChannels() {
  try {
    const user = await conversationRequestViewer(await getCurrentUser())
    if (!user || !user.isActive) {
      return { success: false, error: "Unauthorized" }
    }
    const scope = await getProjectAudienceRequestScope()
    const orgId = requireOrg(user)

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)
    const viewerIsInternal = isInternalStaffRole(user.role)

    // get all channels the user can access:
    // - public channels in their org
    // - private channels they're a member of
    const allChannels = await db
      .select({
        id: channels.id,
        name: channels.name,
        type: channels.type,
        description: channels.description,
        organizationId: channels.organizationId,
        projectId: channels.projectId,
        categoryId: channels.categoryId,
        isPrivate: channels.isPrivate,
        audience: channels.audience,
        sortOrder: channels.sortOrder,
        archivedAt: channels.archivedAt,
        createdAt: channels.createdAt,
        updatedAt: channels.updatedAt,
        memberRole: channelMembers.role,
        unreadCount: channelReadState.unreadCount,
      })
      .from(channels)
      .leftJoin(
        channelMembers,
        and(
          eq(channelMembers.channelId, channels.id),
          eq(channelMembers.userId, user.id)
        )
      )
      .leftJoin(
        channelReadState,
        and(
          eq(channelReadState.channelId, channels.id),
          eq(channelReadState.userId, user.id)
        )
      )
      .where(
        and(
          // must be in user's org
          eq(channels.organizationId, orgId),
          scope ? eq(channels.projectId, scope.projectId) : undefined,
          scope ? eq(channels.audience, scope.audience === "owner" ? "clients" : "sub_vendors") : undefined,
          // External project users only discover conversations they belong to.
          viewerIsInternal
            ? sql`(${channels.isPrivate} = 0 OR ${channelMembers.userId} IS NOT NULL)`
            : and(
                sql`${channelMembers.userId} IS NOT NULL`,
                sql`${channels.id} NOT LIKE 'bt-message-archive-%'`
              ),
          // not archived
          sql`${channels.archivedAt} IS NULL`
        )
      )
      .orderBy(channels.sortOrder, channels.createdAt)

    return { success: true, data: allChannels }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to list channels",
    }
  }
}

/** One channel with its member count, if the signed-in viewer may open it. */
export async function readChannelForViewer(channelId: string) {
  try {
    const user = await conversationRequestViewer(await getCurrentUser())
    if (!user || !user.isActive) {
      return { success: false, error: "Unauthorized" }
    }

    const { env } = await getCloudflareContext()
    const db = getDb(env.DB)

    // verify user has access
    const channel = await db
      .select()
      .from(channels)
      .where(eq(channels.id, channelId))
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (!channel) {
      return { success: false, error: "Channel not found" }
    }

    const scope = await getProjectAudienceRequestScope()
    if (scope && (channel.projectId !== scope.projectId || channel.audience !== (scope.audience === "owner" ? "clients" : "sub_vendors"))) return { success: false, error: "Channel not found" }
    const orgId = requireOrg(user)
    if (channel.organizationId !== orgId) {
      return { success: false, error: "Channel not found" }
    }

    const membership = await db
      .select()
      .from(channelMembers)
      .where(
        and(
          eq(channelMembers.channelId, channelId),
          eq(channelMembers.userId, user.id)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (
      isBuildertrendArchiveChannelId(channel.id)
        ? !isInternalStaffRole(user.role)
        : (channel.isPrivate || !isInternalStaffRole(user.role)) && !membership
    ) {
      return { success: false, error: "Access denied" }
    }

    // count members
    const memberCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(channelMembers)
      .where(eq(channelMembers.channelId, channelId))
      .then((rows) => rows[0]?.count ?? 0)

    return {
      success: true,
      data: {
        ...channel,
        memberCount,
      },
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to get channel",
    }
  }
}
