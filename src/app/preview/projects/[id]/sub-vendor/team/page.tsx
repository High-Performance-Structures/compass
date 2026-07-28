export const dynamic = "force-dynamic"

import type * as React from "react"

import { ProjectAudienceWorkspaceRoute } from "@/components/projects/project-audience-workspace-route"

export default async function PartnerTeamPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}): Promise<React.ReactElement> {
  const { id } = await params
  return (
    <ProjectAudienceWorkspaceRoute
      projectId={id}
      audience="sub_vendor"
      section="team"
    />
  )
}
