export const dynamic = "force-dynamic"

import { requireProjectRouteId } from "@/lib/project-route-id"
import type * as React from "react"

import { ProjectAudienceConversation } from "@/components/projects/project-audience-conversation"

export default async function SubVendorConversationPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{
    readonly id: string
    readonly channelId: string
  }>
  readonly searchParams: Promise<{
    readonly mention?: string | readonly string[]
    readonly label?: string | readonly string[]
  }>
}): Promise<React.ReactElement> {
  const { id: rawProjectId, channelId } = await params
  const id = await requireProjectRouteId(rawProjectId)
  const query = await searchParams
  const mention =
    typeof query.mention === "string" ? query.mention : query.mention?.[0]
  const label =
    typeof query.label === "string" ? query.label : query.label?.[0]

  return (
    <ProjectAudienceConversation
      projectId={id}
      channelId={channelId}
      audience="sub_vendor"
      initialMention={
        mention && label ? { userId: mention, label } : undefined
      }
    />
  )
}
