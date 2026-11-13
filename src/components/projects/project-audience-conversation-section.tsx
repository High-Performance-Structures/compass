import type * as React from "react"
import Link from "next/link"
import { IconMessageCircle } from "@tabler/icons-react"

import { getCorrespondenceInbox } from "@/app/actions/project-correspondence"
import type {
  AudienceMessageChannel,
  ProjectAudience,
  ProjectAudiencePreview as ProjectAudiencePreviewData,
} from "@/app/actions/project-audience-preview"
import { ProjectCorrespondenceWorkspace } from "@/components/correspondence/project-correspondence-workspace"
import { ProjectConversationsTab, type ProjectConversationsQuery } from "@/components/conversations/project-conversations-tab"
import { ProjectMessagesTabs } from "@/components/conversations/project-messages-tabs"
import { ProjectAudienceConversationPane } from "@/components/projects/project-audience-conversation"
import { ProjectAudienceCorrespondencePreview } from "@/components/projects/project-audience-correspondence-preview"
import { Badge } from "@/components/ui/badge"
import { isCorrespondenceEnabled } from "@/lib/correspondence/access"
import { getCloudflareContext } from "@/lib/db"
import {
  projectAudienceConversationHref,
  projectAudienceSectionHref,
} from "@/lib/project-audience-preview-routes"

/*
 * The Messages section of an owner's or vendor's workspace: the job's emails,
 * and a Conversations tab listing the job conversations this person is in.
 */

function MessageChannelRow({
  channel,
  projectId,
  audience,
}: {
  readonly channel: AudienceMessageChannel
  readonly projectId: string
  readonly audience: ProjectAudience
}): React.ReactElement {
  const routeAudience = audience === "owner" ? "owner" : "sub-vendor"

  return (
    <Link
      href={projectAudienceConversationHref(
        projectId,
        routeAudience,
        channel.id
      )}
      className="block rounded-md border bg-background p-3 transition-colors hover:bg-accent"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="line-clamp-1 text-sm font-medium">{channel.name}</p>
        <Badge variant={channel.isPrivate ? "secondary" : "outline"}>
          {channel.isPrivate ? "Private" : "Project"}
        </Badge>
      </div>
      {channel.description && (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
          {channel.description}
        </p>
      )}
    </Link>
  )
}

export async function AudienceConversationSection({
  data,
  initialNewMessage = false,
  conversationsQuery = null,
}: {
  readonly data: ProjectAudiencePreviewData
  readonly initialNewMessage?: boolean
  readonly conversationsQuery?: ProjectConversationsQuery | null
}): Promise<React.ReactElement> {
  const { env } = await getCloudflareContext()
  if (isCorrespondenceEnabled(data.project.id, env) || isCorrespondenceEnabled(data.project.id)) {
    const inbox = await getCorrespondenceInbox(data.project.id)
    const route = data.audience === "owner" ? "owner" : "sub-vendor"
    const basePath = projectAudienceSectionHref(data.project.id, route, "conversations")
    return <section id="messages" className="flex min-w-0 flex-col">
      <ProjectMessagesTabs active={conversationsQuery ? "conversations" : "emails"} emailsHref={basePath} conversationsHref={`${basePath}?view=conversations`} />
      {conversationsQuery
        ? <div className="flex h-[calc(100dvh-11rem)] min-h-[32rem] border">
          {/* A fixed-height frame so the list and the open conversation scroll on their own, as on the staff page. */}
          <ProjectConversationsTab
            projectId={data.project.id}
            basePath={basePath}
            baseParams={{ view: "conversations" }}
            query={conversationsQuery}
            currentUser={null}
            renderChannel={(channelId) => <ProjectAudienceConversationPane projectId={data.project.id} channelId={channelId} audience={data.audience} />}
          />
          </div>
        : inbox.success ? data.viewerIsInternal ? <ProjectAudienceCorrespondencePreview key={inbox.data.viewerId} projectId={data.project.id} inbox={inbox.data} /> : <ProjectCorrespondenceWorkspace projectId={data.project.id} initialInbox={inbox.data} initialNewMessage={initialNewMessage} /> : <p className="p-4 text-sm">Messages are unavailable. {inbox.error}</p>}
    </section>
  }
  return (
    <section
      id="messages"
      className="scroll-mt-24 border bg-background p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <IconMessageCircle className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Project Conversations</h2>
        </div>
        <Badge variant="outline">
          {data.messageChannels.length}{" "}
          {data.messageChannels.length === 1
            ? "conversation"
            : "conversations"}
        </Badge>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Messages here go only to the internal project team and approved
        participants in this private workspace.
      </p>
      {data.messageChannels.length > 0 ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {data.messageChannels.map((channel) => (
            <MessageChannelRow
              key={channel.id}
              channel={channel}
              projectId={data.project.id}
              audience={data.audience}
            />
          ))}
        </div>
      ) : (
        <p className="mt-4 border p-3 text-sm text-muted-foreground">
          Your private project conversation will appear when access is
          activated.
        </p>
      )}
    </section>
  )
}
