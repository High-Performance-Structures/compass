export const dynamic = "force-dynamic"

import { decodeProjectRouteId } from "@/lib/project-route-id"
import type * as React from "react"

import { ProjectAudienceWorkspaceRoute } from "@/components/projects/project-audience-workspace-route"

export default async function PartnerPhotosPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}): Promise<React.ReactElement> {
  const { id: rawProjectId } = await params
  const id = decodeProjectRouteId(rawProjectId)
  return (
    <ProjectAudienceWorkspaceRoute
      projectId={id}
      audience="sub_vendor"
      section="photos"
    />
  )
}
