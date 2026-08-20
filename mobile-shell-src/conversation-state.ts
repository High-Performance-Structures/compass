import type { FieldProjectPacket } from "../src/lib/field/types"

type OptimisticDirectMessage = {
  readonly channelId: string
  readonly id: string
  readonly content: string
  readonly createdAt: string
  readonly userName: string
}

export function appendOptimisticDirectMessage(
  packet: FieldProjectPacket,
  message: OptimisticDirectMessage
): FieldProjectPacket {
  return {
    ...packet,
    directConversations: packet.directConversations.map((conversation) =>
      conversation.id === message.channelId
        ? {
            ...conversation,
            messages: [
              ...conversation.messages.filter((item) => item.id !== message.id),
              {
                id: message.id,
                content: message.content,
                createdAt: message.createdAt,
                userName: message.userName,
              },
            ],
          }
        : conversation
    ),
  }
}

export function pushNotificationHref(data: unknown): string | null {
  if (!data || typeof data !== "object") return null
  if ("url" in data && typeof data.url === "string") return data.url
  if ("href" in data && typeof data.href === "string") return data.href
  return null
}
