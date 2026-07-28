export const dynamic = "force-dynamic"

import type * as React from "react"

import { ProjectAudienceConversation } from "@/components/projects/project-audience-conversation"

export default async function OwnerConversationPage({
  params,
}: {
  readonly params: Promise<{
    readonly id: string
    readonly channelId: string
  }>
}): Promise<React.ReactElement> {
  const { id, channelId } = await params

  return (
    <ProjectAudienceConversation
      projectId={id}
      channelId={channelId}
      audience="owner"
    />
  )
}
