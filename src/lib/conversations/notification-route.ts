import { isInternalStaffRole } from "@/lib/user-roles"

const CONVERSATION_PATH_PREFIX = "/dashboard/conversations/"

export function conversationPanelOpenedAnnouncement(): string {
  return "Conversation opened in side panel."
}

export function conversationFullViewHref(channelId: string): string {
  return `${CONVERSATION_PATH_PREFIX}${encodeURIComponent(channelId)}`
}

/**
 * Returns the channel id only for a first-party full-page conversation route.
 * Other notification targets must continue through their normal navigation path.
 */
export function notificationPanelChannelId({
  href,
  isMobile,
  hasConversationPanel,
}: {
  readonly href: string
  readonly isMobile: boolean
  readonly hasConversationPanel: boolean
}): string | null {
  if (isMobile || !hasConversationPanel) return null
  return conversationChannelIdFromNotificationHref(href)
}

export function conversationChannelIdFromNotificationHref(
  href: string,
): string | null {
  if (!href.startsWith(CONVERSATION_PATH_PREFIX)) return null

  try {
    const url = new URL(href, "https://compass.local")
    const pathAfterPrefix = url.pathname.slice(CONVERSATION_PATH_PREFIX.length)
    if (!pathAfterPrefix || pathAfterPrefix.includes("/")) return null

    const channelId = decodeURIComponent(pathAfterPrefix)
    return channelId.length > 0 ? channelId : null
  } catch {
    return null
  }
}

/** Resolve a shared notification link using the authenticated recipient, never the sender. */
export function conversationRecipientHref(
  channel: {
    readonly id: string
    readonly projectId: string | null
    readonly audience: string
  },
  recipientRole: string,
): string {
  if (!isInternalStaffRole(recipientRole) && channel.projectId) {
    const workspace =
      channel.audience === "clients"
        ? "owner"
        : channel.audience === "sub_vendors"
          ? "sub-vendor"
          : null
    if (workspace) {
      return `/preview/projects/${encodeURIComponent(channel.projectId)}/${workspace}/conversations/${encodeURIComponent(channel.id)}`
    }
  }
  return conversationFullViewHref(channel.id)
}

/** Repair already-issued bell links without changing stored events or their recipients. */
export function recipientNotificationHref(
  href: string,
  recipientRole: string,
): string {
  if (!isInternalStaffRole(recipientRole)) return href
  const match = href.match(
    /^\/preview\/projects\/[^/?#]+\/(?:owner|sub-vendor)\/conversations\/([^/?#]+)([?#].*)?$/,
  )
  if (!match?.[1]) return href
  try {
    return `${conversationFullViewHref(decodeURIComponent(match[1]))}${match[2] ?? ""}`
  } catch {
    return href
  }
}
