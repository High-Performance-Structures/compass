import { notFound } from "next/navigation"
import { getChannel } from "@/app/actions/conversations"
import { getMessages } from "@/app/actions/chat-messages"
import { getProjectContactsSummary } from "@/app/actions/project-contacts"
import { ChannelHeader } from "@/components/conversations/channel-header"
import { MessageList } from "@/components/conversations/message-list"
import {
  MessageComposer,
  type ProjectRecipientContact,
} from "@/components/conversations/message-composer"
import { ThreadPanel } from "@/components/conversations/thread-panel"

export default async function ChannelPage({
  params,
}: {
  readonly params: Promise<{ readonly channelId: string }>
}) {
  const { channelId } = await params
  const [channelResult, messagesResult] = await Promise.all([
    getChannel(channelId),
    getMessages(channelId),
  ])

  if (!channelResult.success || !channelResult.data) {
    notFound()
  }

  const channel = channelResult.data
  const messages = messagesResult.success && messagesResult.data ? messagesResult.data : []
  const contactsSummary = channel.projectId
    ? await getProjectContactsSummary(channel.projectId).catch(() => null)
    : null
  const projectRecipients: readonly ProjectRecipientContact[] =
    contactsSummary?.allContacts.map((contact) => ({
      id: contact.id,
      contactType: contact.contactType,
      displayName: contact.displayName,
      companyName: contact.companyName,
      role: contact.role,
      trade: contact.trade,
      email: contact.email,
    })) ?? []

  return (
    <div className="flex h-full w-full min-w-0 overflow-hidden">
      <div
        className="grid min-w-0 flex-1 overflow-hidden"
        style={{ gridTemplateRows: "auto 1fr auto" }}
      >
        <ChannelHeader
          channelId={channelId}
          name={channel.name}
          description={channel.description ?? undefined}
          memberCount={channel.memberCount}
        />
        <MessageList
          channelId={channelId}
          initialMessages={messages}
        />
        <MessageComposer
          channelId={channelId}
          channelName={channel.name}
          organizationId={channel.organizationId}
          projectRecipients={projectRecipients}
        />
      </div>
      <ThreadPanel />
    </div>
  )
}
