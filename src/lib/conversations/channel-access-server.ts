import "server-only"
import { and, eq } from "drizzle-orm"
import { projects } from "@/db/schema"
import { channelMembers, channels } from "@/db/schema-conversations"
import type { getDb } from "@/db"
import type { AuthUser } from "@/lib/auth"
import { requireOrg } from "@/lib/org-scope"
import { conversationRequestViewer } from "./preview-viewer"
import { getProjectAudienceRequestScope } from "@/lib/project-audience-request-server"
import { canAccessConversationChannel, importedConversationAccess, type ConversationChannelAccess } from "./channel-access"

export async function getConversationChannelAccess(input: {
  readonly db: ReturnType<typeof getDb>
  readonly user: AuthUser
  readonly channelId: string
}): Promise<ConversationChannelAccess | null> {
  const user = await conversationRequestViewer(input.user)
  if (!user) return null
  const scope = await getProjectAudienceRequestScope()
  const channel = await input.db
    .select({
      id: channels.id,
      name: channels.name,
      organizationId: channels.organizationId,
      projectId: channels.projectId,
      isPrivate: channels.isPrivate,
      audience: channels.audience,
      sourceSystem: channels.sourceSystem,
      projectStaffOnly: projects.importedConversationsStaffOnly,
    })
    .from(channels)
    .leftJoin(projects, eq(projects.id, channels.projectId))
    .where(eq(channels.id, input.channelId))
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (scope && (channel?.projectId !== scope.projectId || channel.audience !== (scope.audience === "owner" ? "clients" : "sub_vendors"))) return null
  if (!channel || channel.organizationId !== requireOrg(user)) {
    return null
  }
  if (!user.isActive) return null

  const membership = await input.db
    .select({ id: channelMembers.id })
    .from(channelMembers)
    .where(
      and(
        eq(channelMembers.channelId, input.channelId),
        eq(channelMembers.userId, user.id)
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)

  const access = {
    id: channel.id,
    name: channel.name,
    organizationId: channel.organizationId,
    projectId: channel.projectId,
    isPrivate: channel.isPrivate,
    audience: channel.audience,
  }
  return canAccessConversationChannel({
    channelId: channel.id,
    hasMembership: membership !== null,
    isActive: user.isActive,
    isPrivate: channel.isPrivate,
    audience: channel.audience,
    role: user.role,
    imported: importedConversationAccess(channel),
  })
    ? access
    : null
}
