import type * as React from "react"
import { notFound } from "next/navigation"

import { getProjectAudiencePreview } from "@/app/actions/project-audience-preview"
import { getVendorWarrantyWorkspace } from "@/app/actions/project-warranty-vendor"
import { ProjectAudiencePreviewShell } from "@/components/projects/project-audience-preview-shell"
import { VendorWarrantyList } from "@/components/projects/vendor-warranty-list"
import { projectAudienceMessageShortcut } from "@/lib/project-audience-direct-message"

function hasDigest(error: unknown): error is { readonly digest: string } {
  return typeof error === "object" && error !== null && "digest" in error
}

/** The sub/vendor Warranty page: only claims assigned to them or their company. */
export async function ProjectVendorWarranty({
  projectId,
}: {
  readonly projectId: string
}): Promise<React.ReactElement> {
  let preview: Awaited<ReturnType<typeof getProjectAudiencePreview>>
  let workspace: Awaited<ReturnType<typeof getVendorWarrantyWorkspace>>
  try {
    ;[preview, workspace] = await Promise.all([
      getProjectAudiencePreview(projectId, "sub_vendor"),
      getVendorWarrantyWorkspace(projectId),
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
      audience="sub_vendor"
      projectId={preview.project.id}
      projectName={preview.project.name}
      projectNumber={preview.project.projectNumber}
      projectOptions={preview.projectOptions}
      viewer={preview.viewer}
      viewerIsInternal={preview.viewerIsInternal}
      messageShortcut={messageShortcut}
      activeSection="warranty"
      warrantyEnabled={preview.project.warrantyEnabled}
    >
      <main className="min-h-screen bg-background px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <VendorWarrantyList projectId={projectId} workspace={workspace} />
        </div>
      </main>
    </ProjectAudiencePreviewShell>
  )
}
