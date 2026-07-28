export const dynamic = "force-dynamic"

import type * as React from "react"

import { ProjectAudienceWorkspaceRoute } from "@/components/projects/project-audience-workspace-route"

export default async function OwnerUpdatesPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}): Promise<React.ReactElement> {
  const { id } = await params
  return (
    <ProjectAudienceWorkspaceRoute
      projectId={id}
      audience="owner"
      section="updates"
    />
  )
}
