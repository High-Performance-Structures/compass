"use server"

import { getMessages } from "@/app/actions/chat-messages"
import { getChannel } from "@/app/actions/conversations"
import { getProjectContactsSummary } from "@/app/actions/project-contacts"
import { getCurrentUser } from "@/lib/auth"

export type ConversationPanelProjectRecipient = {
  readonly id: string
  readonly contactType: "owner" | "supplier" | "subcontractor" | "internal"
  readonly displayName: string
  readonly companyName: string | null
  readonly role: string | null
  readonly trade: string | null
  readonly email: string | null
}

type ConversationPanelChannel = {
  readonly id: string
  readonly name: string
  readonly description: string | null
  readonly organizationId: string
  readonly projectId: string | null
  readonly archivedAt: string | null
}

type ConversationPanelMessage = {
  readonly id: string
  readonly channelId: string
  readonly threadId: string | null
  readonly content: string
  readonly contentHtml: string | null
  readonly editedAt: string | null
  readonly deletedAt: string | null
  readonly isPinned: boolean
  readonly replyCount: number
  readonly lastReplyAt: string | null
  readonly createdAt: string
  readonly user: {
    readonly id: string
    readonly displayName: string | null
    readonly email: string
    readonly role: string
    readonly avatarUrl: string | null
  } | null
  readonly attachments: readonly {
    readonly id: string
    readonly fileName: string
    readonly mimeType: string
    readonly fileSize: number
    readonly storageProvider: string
    readonly driveFileId: string | null
    readonly driveUrl: string | null
    readonly downloadUrl: string | null
    readonly uploadedAt: string
    readonly storageUrl: string
  }[]
  readonly reactions: readonly {
    readonly emoji: string
    readonly count: number
    readonly reactedByCurrentUser: boolean
  }[]
}

export async function getConversationPanelData(channelId: string): Promise<
  | {
      readonly success: true
      readonly data: {
        readonly channel: ConversationPanelChannel
        readonly currentUserId: string
        readonly messages: readonly ConversationPanelMessage[]
        readonly projectRecipients: readonly ConversationPanelProjectRecipient[]
      }
    }
  | { readonly success: false; readonly error: string }
> {
  const [channelResult, messagesResult, currentUser] = await Promise.all([
    getChannel(channelId),
    getMessages(channelId),
    getCurrentUser(),
  ])

  if (!channelResult.success || !channelResult.data || !currentUser) {
    return {
      success: false,
      error:
        !channelResult.success
          ? channelResult.error ?? "Unable to load this conversation."
          : "Unable to load this conversation.",
    }
  }

  const channel = channelResult.data
  const contactsSummary = channel.projectId
    ? await getProjectContactsSummary(channel.projectId).catch(() => null)
    : null
  const messages = messagesResult.success && messagesResult.data
    ? messagesResult.data.map((message) => ({
      ...message,
      user: message.user
        ? { ...message.user, role: "" }
        : null,
      attachments: message.attachments.map((attachment) => ({
        id: attachment.id,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        fileSize: attachment.fileSize,
        storageProvider: "r2",
        driveFileId: null,
        driveUrl: null,
        downloadUrl: attachment.storageUrl,
        uploadedAt: "",
        storageUrl: attachment.storageUrl,
      })),
    }))
    : []

  const projectRecipients: readonly ConversationPanelProjectRecipient[] =
    contactsSummary?.allContacts.map((contact) => ({
      id: contact.id,
      contactType: contact.contactType,
      displayName: contact.displayName,
      companyName: contact.companyName,
      role: contact.role,
      trade: contact.trade,
      email: contact.email,
    })) ?? []

  return {
    success: true,
    data: {
      channel: {
        id: channel.id,
        name: channel.name,
        description: channel.description,
        organizationId: channel.organizationId,
        projectId: channel.projectId,
        archivedAt: channel.archivedAt,
      },
      currentUserId: currentUser.id,
      messages,
      projectRecipients,
    },
  }
}
