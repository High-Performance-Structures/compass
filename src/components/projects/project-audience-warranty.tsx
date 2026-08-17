import type * as React from "react"
import { notFound } from "next/navigation"

import { getProjectAudiencePreview } from "@/app/actions/project-audience-preview"
import { getProjectWarrantyWorkspace } from "@/app/actions/project-warranty"
import { ProjectAudiencePreviewShell } from "@/components/projects/project-audience-preview-shell"
import { ProjectWarrantyWorkspace } from "@/components/projects/project-warranty-workspace"
import { projectAudienceMessageShortcut } from "@/lib/project-audience-direct-message"

function hasDigest(error: unknown): error is { readonly digest: string } {
  return typeof error === "object" && error !== null && "digest" in error
}

export async function ProjectAudienceWarranty({
  projectId,
}: {
  readonly projectId: string
}): Promise<React.ReactElement> {
  let preview: Awaited<ReturnType<typeof getProjectAudiencePreview>>
  let workspace: Awaited<ReturnType<typeof getProjectWarrantyWorkspace>>
  try {
    ;[preview, workspace] = await Promise.all([
      getProjectAudiencePreview(projectId, "owner"),
      getProjectWarrantyWorkspace(projectId),
    ])
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
      audience="owner"
      projectId={preview.project.id}
      projectName={preview.project.name}
      projectNumber={preview.project.projectNumber}
      projectOptions={preview.projectOptions}
      viewer={preview.viewer}
      viewerIsInternal={preview.viewerIsInternal}
      messageShortcut={messageShortcut}
      activeSection="warranty"
      warrantyEnabled={workspace.project.warrantyEnabled}
    >
      <main className="min-h-screen bg-[oklch(0.96_0.018_115)] px-4 py-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl overflow-hidden rounded-lg border">
          <ProjectWarrantyWorkspace workspace={workspace} />
        </div>
      </main>
    </ProjectAudiencePreviewShell>
  )
}
