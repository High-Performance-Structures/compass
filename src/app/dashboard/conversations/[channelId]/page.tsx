import { notFound } from "next/navigation"
import { getChannel } from "@/app/actions/conversations"
import { getMessages } from "@/app/actions/chat-messages"
import { ChannelHeader } from "@/components/conversations/channel-header"
import { MessageList } from "@/components/conversations/message-list"
import { MessageComposer } from "@/components/conversations/message-composer"
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

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <ChannelHeader
          name={channel.name}
          description={channel.description ?? undefined}
          memberCount={channel.memberCount}
        />
        <MessageList
          channelId={channelId}
          initialMessages={messages}
        />
        <MessageComposer channelId={channelId} channelName={channel.name} />
      </div>
      <ThreadPanel />
    </>
  )
}
