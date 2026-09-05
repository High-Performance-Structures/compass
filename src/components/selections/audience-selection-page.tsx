import type * as React from "react"
import { notFound } from "next/navigation"
import { getProjectAudiencePreview } from "@/app/actions/project-audience-preview"
import { getSelectionWorkspace } from "@/app/actions/selection-decisions-read"
import { ProjectAudiencePreviewShell } from "@/components/projects/project-audience-preview-shell"
import { SelectionDecisionWorkspace } from "./selection-decision-workspace"
import { projectAudienceMessageShortcut } from "@/lib/project-audience-direct-message"
import type { ProjectAudience } from "@/lib/project-audience-access"

export async function AudienceSelectionPage({
  projectId,
  audience,
}: {
  readonly projectId: string
  readonly audience: ProjectAudience
}): Promise<React.ReactElement> {
  const data = await getProjectAudiencePreview(projectId, audience).catch(() =>
    notFound()
  )
  const workspace = await getSelectionWorkspace(projectId, audience)
  const shortcut = projectAudienceMessageShortcut({
    projectId,
    audience,
    viewerId: data.viewer.id,
    contacts: data.contacts,
    messageChannels: data.messageChannels,
  })
  return (
    <ProjectAudiencePreviewShell
      audience={audience}
      projectId={projectId}
      projectName={data.project.name}
      projectNumber={data.project.projectNumber}
      projectOptions={data.projectOptions}
      viewer={data.viewer}
      viewerIsInternal={data.viewerIsInternal}
      messageShortcut={shortcut}
      activeSection="selections"
      warrantyEnabled={data.project.warrantyEnabled}
    >
      <main className="min-h-screen bg-background">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
          <SelectionDecisionWorkspace workspace={workspace} reportProject={data.project} />
        </div>
      </main>
    </ProjectAudiencePreviewShell>
  )
}
