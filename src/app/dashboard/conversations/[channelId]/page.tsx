import { notFound } from "next/navigation"
import { getChannel } from "@/app/actions/conversations"
import { getMessages } from "@/app/actions/chat-messages"
import { getProjectContactsSummary } from "@/app/actions/project-contacts"
import { getProjects } from "@/app/actions/projects"
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
  const [contactsSummary, projects] = await Promise.all([
    channel.projectId
      ? getProjectContactsSummary(channel.projectId).catch(() => null)
      : Promise.resolve(null),
    channel.projectId ? getProjects() : Promise.resolve([]),
  ])
  const project =
    channel.projectId
      ? projects.find((item) => item.id === channel.projectId) ?? null
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
    <div className="flex h-full w-full min-w-0 overflow-hidden pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
      <div
        className="grid min-h-0 min-w-0 flex-1 overflow-hidden"
        style={{ gridTemplateRows: "auto 1fr auto" }}
      >
        <ChannelHeader
          channelId={channelId}
          name={channel.name}
          description={channel.description ?? undefined}
          project={project}
          memberCount={channel.memberCount}
          audience={channel.audience}
          archivedAt={channel.archivedAt}
          canUpdate={channel.canUpdate}
          canDelete={channel.canDelete}
          canManageMembers={channel.canManageMembers}
        />
        <MessageList
          channelId={channelId}
          initialMessages={messages}
        />
        {channel.archivedAt ? (
          <div className="border-t bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            This conversation is archived. Restore it from the channel menu to
            send new messages.
          </div>
        ) : (
          <MessageComposer
            channelId={channelId}
            channelName={channel.name}
            organizationId={channel.organizationId}
            isProjectChannel={Boolean(channel.projectId)}
            projectRecipients={projectRecipients}
          />
        )}
      </div>
      <ThreadPanel />
    </div>
  )
}
