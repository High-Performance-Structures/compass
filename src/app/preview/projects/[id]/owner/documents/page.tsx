export const dynamic = "force-dynamic"

import type * as React from "react"

import { ProjectAudienceWorkspaceRoute } from "@/components/projects/project-audience-workspace-route"
import { requireProjectRouteId } from "@/lib/project-route-id"

export default async function OwnerDocumentsPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}): Promise<React.ReactElement> {
  const { id: rawProjectId } = await params
  const id = await requireProjectRouteId(rawProjectId)
  return (
    <ProjectAudienceWorkspaceRoute
      projectId={id}
      audience="owner"
      section="documents"
    />
  )
}
