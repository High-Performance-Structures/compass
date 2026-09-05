export const dynamic = "force-dynamic"

import { requireProjectRouteId } from "@/lib/project-route-id"
import type * as React from "react"

import { ProjectAudienceWorkspaceRoute } from "@/components/projects/project-audience-workspace-route"

export default async function OwnerConversationsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly id: string }>
  readonly searchParams: Promise<{ readonly quickAdd?: string | readonly string[] }>
}): Promise<React.ReactElement> {
  const { id: rawProjectId } = await params
  const query = await searchParams
  const id = await requireProjectRouteId(rawProjectId)
  return (
    <ProjectAudienceWorkspaceRoute
      projectId={id}
      audience="owner"
      section="conversations"
      initialNewMessage={singleQueryValue(query.quickAdd) === "message"}
    />
  )
}

function singleQueryValue(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : value?.[0]
}
