import { getDb } from "@/db"
import { channelMembers, userPresence } from "@/db/schema-conversations"
import { eq } from "drizzle-orm"
import { sendPushNotification } from "@/lib/push/send"

type MentionTarget = Readonly<{
  mentionType: "user" | "channel" | "here" | "agent"
  targetId: string | null
}>

export async function notifyMentionedUsers(
  d1: D1Database,
  fcmServerKey: string,
  messageId: string,
  channelId: string,
  senderId: string,
  senderName: string,
  mentions: ReadonlyArray<MentionTarget>,
): Promise<void> {
  // resolve each mention to a set of userIds
  const db = getDb(d1)
  const notifyUserIds = new Set<string>()

  for (const mention of mentions) {
    switch (mention.mentionType) {
      case "user": {
        if (mention.targetId && mention.targetId !== senderId) {
          notifyUserIds.add(mention.targetId)
        }
        break
      }
      case "channel": {
        // all channel members
        const members = await db
          .select({ userId: channelMembers.userId, notifyLevel: channelMembers.notifyLevel })
          .from(channelMembers)
          .where(eq(channelMembers.channelId, channelId))
        for (const m of members) {
          if (m.userId !== senderId && m.notifyLevel !== "none") {
            notifyUserIds.add(m.userId)
          }
        }
        break
      }
      case "here": {
        // online channel members (check userPresence)
        const members = await db
          .select({ userId: channelMembers.userId, notifyLevel: channelMembers.notifyLevel })
          .from(channelMembers)
          .where(eq(channelMembers.channelId, channelId))

        const onlineUsers = await db
          .select({ userId: userPresence.userId })
          .from(userPresence)
          .where(eq(userPresence.status, "online"))

        const onlineSet = new Set(onlineUsers.map(u => u.userId))
        for (const m of members) {
          if (m.userId !== senderId && m.notifyLevel !== "none" && onlineSet.has(m.userId)) {
            notifyUserIds.add(m.userId)
          }
        }
        break
      }
      case "agent": {
        // skip -- agents don't have push tokens
        break
      }
    }
  }

  // send push notifications
  const promises = Array.from(notifyUserIds).map(userId =>
    sendPushNotification(d1, fcmServerKey, {
      userId,
      title: `${senderName} mentioned you`,
      body: "You were mentioned in a conversation",
      data: { channelId, messageId, type: "mention" },
    }).catch(err => console.error(`Push failed for ${userId}:`, err))
  )

  await Promise.allSettled(promises)
}
