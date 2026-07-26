import type { NotificationRecipientInput } from "@/lib/notifications/create-event"

export type ChannelMessageMention = {
  readonly mentionType: "user" | "channel" | "here" | "agent"
  readonly targetId: string | null
}

type ChannelNotificationMember = {
  readonly userId: string
  readonly email: string
  readonly notifyLevel: string
}

export function channelNotificationRecipients(
  members: readonly ChannelNotificationMember[],
  senderId: string,
  mentions: readonly ChannelMessageMention[]
): readonly NotificationRecipientInput[] {
  const directlyMentioned = new Set(
    mentions
      .filter(
        (mention) =>
          mention.mentionType === "user" &&
          mention.targetId !== null
      )
      .map((mention) => mention.targetId)
  )
  const mentionsChannel = mentions.some(
    (mention) =>
      mention.mentionType === "channel" ||
      mention.mentionType === "here"
  )

  return members
    .filter((member) => {
      if (member.userId === senderId) return false
      if (member.notifyLevel === "none") return false
      if (member.notifyLevel === "all") return true
      return (
        directlyMentioned.has(member.userId) || mentionsChannel
      )
    })
    .map((member) => ({
      userId: member.userId,
      email: member.email,
    }))
}
