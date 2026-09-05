import type * as React from "react"
import { notFound } from "next/navigation"

import {
  getProjectAudiencePreview,
  type ProjectAudiencePreview as ProjectAudiencePreviewData,
} from "@/app/actions/project-audience-preview"
import { ProjectAudiencePreview } from "@/components/projects/project-audience-preview"
import type { ProjectAudience } from "@/lib/project-audience-access"
import type { ProjectAudienceWorkspaceSection } from "@/lib/project-audience-preview-routes"

function hasDigest(error: unknown): error is { readonly digest: string } {
  return typeof error === "object" && error !== null && "digest" in error
}

export async function ProjectAudienceWorkspaceRoute({
  projectId,
  audience,
  section,
  initialNewMessage = false,
}: {
  readonly projectId: string
  readonly audience: ProjectAudience
  readonly section: ProjectAudienceWorkspaceSection
  readonly initialNewMessage?: boolean
}): Promise<React.ReactElement> {
  let data: ProjectAudiencePreviewData

  try {
    data = await getProjectAudiencePreview(projectId, audience)
  } catch (error) {
    if (hasDigest(error) && error.digest === "NEXT_NOT_FOUND") throw error
    notFound()
  }

  return <ProjectAudiencePreview data={data} section={section} initialNewMessage={initialNewMessage} />
}
