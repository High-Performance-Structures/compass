/*
 * Project conversations that live in channels (for example Buildertrend
 * threads imported by scripts/import-buildertrend-messages.mjs) are listed in
 * the project messages inbox next to correspondence. Their inbox id carries a
 * prefix so every action can tell the two models apart without a lookup.
 * Safe for client and server code.
 */
const CHANNEL_THREAD_PREFIX = "channel:"

export function channelThreadConversationId(channelId: string): string {
  return `${CHANNEL_THREAD_PREFIX}${channelId}`
}

/** The channel id behind an inbox id, or null for a correspondence conversation. */
export function channelIdFromConversationId(conversationId: string | null): string | null {
  if (conversationId === null || !conversationId.startsWith(CHANNEL_THREAD_PREFIX)) return null
  const channelId = conversationId.slice(CHANNEL_THREAD_PREFIX.length)
  return channelId.length > 0 ? channelId : null
}

export function isChannelThreadId(conversationId: string | null): boolean {
  return channelIdFromConversationId(conversationId) !== null
}

/** Inbox state (Saved, Needs reply, Archive, Close, receipts) is stored only for correspondence. */
export const CHANNEL_THREAD_STATE_UNAVAILABLE =
  "Saved, Needs reply, Archive and Close aren't available for imported conversations yet."
