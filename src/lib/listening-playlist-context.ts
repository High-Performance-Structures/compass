import { and, eq, isNull } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/db"
import { channelMembers, listeningPlaylists } from "@/db/schema-conversations"
import { getCurrentUser, type AuthUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import { canManageListeningPlaylist } from "@/lib/listening-room"
import { can } from "@/lib/permissions"
import { isInternalStaffRole } from "@/lib/user-roles"
import {
  getVoiceChannelAccess,
  type VoiceChannelAccess,
} from "@/lib/voice-channel-access"

// Shared by the playlist server actions. Kept out of "use server" files so
// these helpers are never exposed as callable actions themselves.

export type PlaylistContext = {
  readonly db: ReturnType<typeof getDb>
  readonly user: AuthUser
  readonly channel: VoiceChannelAccess
  readonly canModerate: boolean
}

export async function playlistContext(
  channelId: string,
  write = false
): Promise<PlaylistContext> {
  const user = await getCurrentUser()
  if (!user || !can(user, "channels", "read")) throw new Error("Unauthorized")
  if (!isInternalStaffRole(user.role)) {
    throw new Error("Listening-room playlists are available to internal staff only")
  }
  if (write && isDemoUser(user.id)) throw new Error("DEMO_READ_ONLY")

  const { env } = await getCloudflareContext()
  const db = getDb(env.DB)
  const channel = await getVoiceChannelAccess(db, user, channelId)
  if (!channel) throw new Error("Voice channel not found")
  const membership = await db
    .select({ role: channelMembers.role })
    .from(channelMembers)
    .where(
      and(
        eq(channelMembers.channelId, channel.id),
        eq(channelMembers.userId, user.id)
      )
    )
    .get()
  const canModerate =
    can(user, "channels", "moderate") ||
    membership?.role === "owner" ||
    membership?.role === "moderator"
  return { db, user, channel, canModerate }
}

export async function activePlaylist(
  context: PlaylistContext,
  playlistId: string
) {
  return context.db
    .select()
    .from(listeningPlaylists)
    .where(
      and(
        eq(listeningPlaylists.id, playlistId),
        eq(listeningPlaylists.organizationId, context.channel.organizationId),
        isNull(listeningPlaylists.deletedAt)
      )
    )
    .get()
}

export function canEditPlaylist(
  context: PlaylistContext,
  createdBy: string
): boolean {
  return canManageListeningPlaylist({
    currentUserId: context.user.id,
    createdBy,
    canModerate: context.canModerate,
  })
}

export function revalidatePlaylistPaths(channelId: string): void {
  revalidatePath(`/dashboard/conversations/${channelId}`)
  revalidatePath(`/dashboard/conversations/${channelId}/listening-room`)
}
