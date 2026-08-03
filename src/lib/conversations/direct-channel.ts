export function directParticipantIds(
  currentUserId: string,
  targetUserIds: readonly string[]
): readonly string[] {
  return Array.from(new Set([currentUserId, ...targetUserIds])).sort()
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
