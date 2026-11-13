import { conversationFullViewHref, conversationRecipientHref } from "@/lib/conversations/notification-route"
import { notFound } from "next/navigation"
import { getChannel } from "@/app/actions/conversations"
import { getCurrentUser } from "@/lib/auth"
import { ChannelView } from "@/components/conversations/channel-view"
import { ClientRedirect } from "@/components/client-redirect"

export default async function ChannelPage({
  params,
}: {
  readonly params: Promise<{ readonly channelId: string }>
}) {
  const { channelId } = await params
  const [channelResult, currentUser] = await Promise.all([
    getChannel(channelId),
    getCurrentUser(),
  ])

  if (!currentUser || !channelResult.success || !channelResult.data) {
    notFound()
  }

  const channel = channelResult.data
  // Shared notification URLs land here. Keep external recipients in their portal
  // after getChannel has verified organization and channel access.
  const recipientHref = conversationRecipientHref(channel, currentUser.role)
  if (recipientHref !== conversationFullViewHref(channel.id)) return <ClientRedirect href={recipientHref} />
  return <ChannelView channel={channel} currentUser={currentUser} />
}
