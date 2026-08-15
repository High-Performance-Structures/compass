import type * as React from "react"
import { notFound } from "next/navigation"

import {
  getProjectAudiencePreview,
  type ProjectAudiencePreview,
} from "@/app/actions/project-audience-preview"
import { ProjectAudienceFiles } from "@/components/projects/project-audience-files"
import { ProjectAudiencePreviewShell } from "@/components/projects/project-audience-preview-shell"
import { projectAudienceMessageShortcut } from "@/lib/project-audience-direct-message"
import type { ProjectAudience } from "@/lib/project-audience-access"

function hasDigest(error: unknown): error is { readonly digest: string } {
  return typeof error === "object" && error !== null && "digest" in error
}

export async function ProjectAudienceFilesRoute({
  projectId,
  audience,
}: {
  readonly projectId: string
  readonly audience: ProjectAudience
}): Promise<React.ReactElement> {
  let preview: ProjectAudiencePreview
  try {
    preview = await getProjectAudiencePreview(projectId, audience)
  } catch (error) {
    if (hasDigest(error) && error.digest === "NEXT_NOT_FOUND") throw error
    notFound()
  }

  const messageShortcut = projectAudienceMessageShortcut({
    projectId: preview.project.id,
    audience: preview.audience,
    viewerId: preview.viewer.id,
    contacts: preview.contacts,
    messageChannels: preview.messageChannels,
  })

  return (
    <ProjectAudiencePreviewShell
      audience={audience}
      projectId={preview.project.id}
      projectName={preview.project.name}
      projectNumber={preview.project.projectNumber}
      projectOptions={preview.projectOptions}
      viewer={preview.viewer}
      viewerIsInternal={preview.viewerIsInternal}
      messageShortcut={messageShortcut}
      activeSection="files"
    >
      <ProjectAudienceFiles
        projectId={preview.project.id}
        audience={audience}
        canUpload={!preview.viewerIsInternal}
      />
    </ProjectAudiencePreviewShell>
  )
}
