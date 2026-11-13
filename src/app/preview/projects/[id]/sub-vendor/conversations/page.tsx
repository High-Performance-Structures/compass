export const dynamic = "force-dynamic"

import { requireProjectRouteId } from "@/lib/project-route-id"
import type * as React from "react"

import { projectConversationsQueryFromSearch } from "@/components/conversations/project-conversations-tab"
import { ProjectAudienceWorkspaceRoute } from "@/components/projects/project-audience-workspace-route"

export default async function PartnerConversationsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly id: string }>
  readonly searchParams: Promise<{ readonly quickAdd?: string | readonly string[]; readonly view?: string | readonly string[]; readonly filter?: string | readonly string[]; readonly q?: string | readonly string[]; readonly page?: string | readonly string[] }>
}): Promise<React.ReactElement> {
  const { id: rawProjectId } = await params
  const query = await searchParams
  const id = await requireProjectRouteId(rawProjectId)
  return (
    <ProjectAudienceWorkspaceRoute
      projectId={id}
      audience="sub_vendor"
      section="conversations"
      initialNewMessage={singleQueryValue(query.quickAdd) === "message"}
      conversationsQuery={projectConversationsQueryFromSearch(query)}
    />
  )
}

function singleQueryValue(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : value?.[0]
}
