import type * as React from "react"
import { notFound } from "next/navigation"

import { getMessages } from "@/app/actions/chat-messages"
import { getChannel } from "@/app/actions/conversations"
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
    // Loading the preview first synchronizes the private audience channel's
    // current owner/partner and internal-team memberships before message
    // authorization runs.
    const preview = await getProjectAudiencePreview(projectId, audience)
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
  const { preview, channel, messages } = await loadConversation(
    projectId,
    channelId,
    audience
  )
  const audienceRoute = routeAudience(audience)
  const homeHref = projectAudiencePreviewHref(projectId, audienceRoute)
  const conversationBaseHref = `${homeHref}/conversations`
  const project = {
    id: preview.project.id,
    name: preview.project.name,
    projectNumber: preview.project.projectNumber,
    clientName: preview.project.clientName,
  }
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
    >
      <main className="min-h-0 flex-1 overflow-hidden bg-background">
        <ConversationsProvider>
          <div className="flex h-full w-full min-w-0 overflow-hidden">
            <div
              className="grid min-w-0 flex-1 overflow-hidden"
              style={{ gridTemplateRows: "auto 1fr auto" }}
            >
              <ChannelHeader
                channelId={channelId}
                name={channel.name}
                description={channel.description ?? undefined}
                project={project}
                memberCount={channel.memberCount}
                projectHref={homeHref}
                conversationBaseHref={conversationBaseHref}
              />
              <MessageList channelId={channelId} initialMessages={messages} />
              <MessageComposer
                channelId={channelId}
                channelName={channel.name}
                organizationId={channel.organizationId}
                isProjectChannel={false}
                initialMention={initialMention}
              />
            </div>
            <ThreadPanel />
          </div>
        </ConversationsProvider>
      </main>
    </ProjectAudiencePreviewShell>
  )
}
