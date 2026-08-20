export function directParticipantIds(
  currentUserId: string,
  targetUserIds: readonly string[]
): readonly string[] {
  return Array.from(new Set([currentUserId, ...targetUserIds])).sort()
}

const DIRECT_CHANNEL_ID_PATTERN = /^direct-[a-f0-9]{32}$/

export type DirectConversationChannel = Readonly<{
  id: string
  audience: string
  isPrivate: boolean
  projectId: string | null
  description: string | null
}>

export function isDirectChannelId(channelId: string): boolean {
  return DIRECT_CHANNEL_ID_PATTERN.test(channelId)
}

export function isDirectConversationChannel(
  channel: DirectConversationChannel
): boolean {
  if (isDirectChannelId(channel.id) || channel.audience === "direct") {
    return true
  }

  // The original mobile direct-message flow created UUID channels before the
  // dedicated direct audience existed. Preserve those conversations without
  // treating every private staff channel as a direct message.
  return (
    channel.isPrivate &&
    channel.projectId === null &&
    channel.description?.trim().toLowerCase() === "direct conversation"
  )
}

export async function directChannelId(
  organizationId: string,
  participantIds: readonly string[]
): Promise<string> {
  const participants = [...participantIds].sort().join(":")
  const bytes = new TextEncoder().encode(`${organizationId}:${participants}`)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  const hash = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
  return `direct-${hash.slice(0, 32)}`
}
