import { getConversationChannelAccess } from "@/lib/conversations/channel-access-server"
import type * as React from "react"
import { notFound } from "next/navigation"

import { getMessages } from "@/app/actions/chat-messages"
import { getChannel } from "@/app/actions/conversations"
import { resolveProjectAudienceViewer } from "@/lib/project-audience-viewer"

import { getProjectAudiencePreview } from "@/app/actions/project-audience-preview"
import { ChannelHeader } from "@/components/conversations/channel-header"
import { MessageComposer } from "@/components/conversations/message-composer"
import { MessageList } from "@/components/conversations/message-list"
import { ThreadPanel } from "@/components/conversations/thread-panel"
import { ProjectAudiencePreviewShell } from "@/components/projects/project-audience-preview-shell"
import { ConversationsProvider } from "@/contexts/conversations-context"
import type { ProjectAudience } from "@/lib/project-audience-access"
import {
  projectAudiencePreviewHref,
  type ProjectAudiencePreviewRoute,
} from "@/lib/project-audience-preview-routes"
import { projectAudienceMessageShortcut } from "@/lib/project-audience-direct-message"

function routeAudience(audience: ProjectAudience): ProjectAudiencePreviewRoute {
  return audience === "owner" ? "owner" : "sub-vendor"
}

function expectedChannelAudience(
  audience: ProjectAudience
): "clients" | "sub_vendors" {
  return audience === "owner" ? "clients" : "sub_vendors"
}

function hasDigest(error: unknown): error is { readonly digest: string } {
  return typeof error === "object" && error !== null && "digest" in error
}

async function loadConversation(
  projectId: string,
  channelId: string,
  audience: ProjectAudience
) {
  try {
    const preview = await getProjectAudiencePreview(projectId, audience)
    const context = await resolveProjectAudienceViewer(projectId, audience)
    if (!context.viewer || !(await getConversationChannelAccess({ db: context.db, user: context.viewer, channelId }))) notFound()
    const [channelResult, messagesResult] = await Promise.all([
      getChannel(channelId),
      getMessages(channelId),
    ])

    if (!channelResult.success || !channelResult.data) notFound()
    if (!messagesResult.success || !messagesResult.data) notFound()

    const channel = channelResult.data
    if (
      channel.projectId !== projectId ||
      channel.audience !== expectedChannelAudience(audience)
    ) {
      notFound()
    }

    return {
      preview,
      channel,
      messages: messagesResult.data,
    }
  } catch (error) {
    if (hasDigest(error) && error.digest === "NEXT_NOT_FOUND") throw error
    notFound()
  }
}

type LoadedConversation = Awaited<ReturnType<typeof loadConversation>>

/**
 * One conversation's messages and composer for an owner or vendor (a read-only
 * transcript when staff preview the workspace). The full conversation page and
 * the Messages > Conversations tab both render it after loadConversation.
 */
function ConversationBody({
  data,
  channelId,
  audience,
  initialMention,
}: {
  readonly data: LoadedConversation
  readonly channelId: string
  readonly audience: ProjectAudience
  readonly initialMention?: { readonly userId: string; readonly label: string }
}): React.ReactElement {
  const { preview, channel, messages } = data
  const homeHref = projectAudiencePreviewHref(preview.project.id, routeAudience(audience))
  const project = {
    id: preview.project.id,
    name: preview.project.name,
    projectNumber: preview.project.projectNumber,
    clientName: preview.project.clientName,
  }
  if (preview.viewerIsInternal) {
    return <section className="h-full overflow-y-auto p-5">
      <h1 className="text-lg font-medium">{channel.name}</h1>
      <p className="my-3 text-sm text-muted-foreground">Read-only conversation preview.</p>
      {messages.map((message) => <article key={message.id} className="border-b py-4">
        <p className="text-sm font-medium">{message.user?.displayName ?? message.user?.email ?? "Project participant"}</p>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm">{message.content}</p>
        {message.attachments.map((attachment) => <a className="mt-2 block text-sm underline" key={attachment.id} href={attachment.storageUrl}>{attachment.fileName}</a>)}
      </article>)}
    </section>
  }
  // Keyed by conversation so a half-typed reply or open thread never carries into the next one.
  return <ConversationsProvider key={channelId}>
    <div className="flex h-full w-full min-w-0 overflow-hidden">
      <div
        className="grid min-w-0 flex-1 grid-cols-1 overflow-hidden"
        style={{ gridTemplateRows: "auto 1fr auto" }}
      >
        <ChannelHeader
          channelId={channelId}
          name={channel.name}
          description={channel.description ?? undefined}
          project={project}
          memberCount={channel.memberCount}
          projectHref={homeHref}
          conversationBaseHref={`${homeHref}/conversations`}
        />
        <MessageList
          channelId={channelId}
          initialMessages={messages}
          currentUserId={preview.viewer.id}
        />
        <MessageComposer
          channelId={channelId}
          channelName={channel.name}
          organizationId={channel.organizationId}
          isProjectChannel={false}
          initialMention={initialMention}
        />
      </div>
      <ThreadPanel currentUserId={preview.viewer.id} />
    </div>
  </ConversationsProvider>
}

/** The conversation beside the list on an owner's or vendor's Messages page. */
export async function ProjectAudienceConversationPane({
  projectId,
  channelId,
  audience,
}: {
  readonly projectId: string
  readonly channelId: string
  readonly audience: ProjectAudience
}): Promise<React.ReactElement> {
  let data: LoadedConversation
  try {
    data = await loadConversation(projectId, channelId, audience)
  } catch (error) {
    // A link to a conversation this person can't open shows a note, not a missing page.
    if (!(hasDigest(error) && error.digest === "NEXT_NOT_FOUND")) console.error("project_audience_conversation_pane_failed", error instanceof Error ? error.message : error)
    return <p className="p-6 text-sm text-muted-foreground">This conversation isn't available.</p>
  }
  return <ConversationBody data={data} channelId={channelId} audience={audience} />
}

export async function ProjectAudienceConversation({
  projectId,
  channelId,
  audience,
  initialMention,
}: {
  readonly projectId: string
  readonly channelId: string
  readonly audience: ProjectAudience
  readonly initialMention?: {
    readonly userId: string
    readonly label: string
  }
}): Promise<React.ReactElement> {
  const data = await loadConversation(projectId, channelId, audience)
  const { preview } = data
  const messageShortcut = projectAudienceMessageShortcut({
    projectId: preview.project.id,
    audience,
    viewerId: preview.viewer.id,
    contacts: preview.contacts,
    messageChannels: preview.messageChannels,
  })

  return (
    <ProjectAudiencePreviewShell
      audience={audience}
      projectId={preview.project.id}
      projectName={preview.project.name}
      projectNumber={preview.project.projectNumber}
      projectOptions={preview.projectOptions}
      viewer={preview.viewer}
      viewerIsInternal={preview.viewerIsInternal}
      messageShortcut={messageShortcut}
      contentMode="viewport"
      activeSection="conversations"
      warrantyEnabled={preview.project.warrantyEnabled}
    >
      <main className="min-h-0 flex-1 overflow-hidden bg-background">
        <ConversationBody data={data} channelId={channelId} audience={audience} initialMention={initialMention} />
      </main>
    </ProjectAudiencePreviewShell>
  )
}
