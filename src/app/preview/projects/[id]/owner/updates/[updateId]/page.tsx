export const dynamic = "force-dynamic"

import type * as React from "react"
import { notFound } from "next/navigation"

import {
  getProjectAudiencePreview,
  type ProjectAudiencePreview,
} from "@/app/actions/project-audience-preview"
import {
  getOwnerProjectUpdateDocument,
  type OwnerProjectUpdateDocument,
} from "@/app/actions/project-field"
import { OwnerUpdateDocument } from "@/components/projects/owner-update-document"
import { ProjectAudiencePreviewShell } from "@/components/projects/project-audience-preview-shell"
import { projectAudiencePreviewHref } from "@/lib/project-audience-preview-routes"

function hasDigest(error: unknown): error is { readonly digest: string } {
  return typeof error === "object" && error !== null && "digest" in error
}

async function loadOwnerUpdatePreview(
  projectId: string,
  updateId: string
): Promise<{
  readonly document: OwnerProjectUpdateDocument
  readonly preview: ProjectAudiencePreview
}> {
  try {
    const [document, preview] = await Promise.all([
      getOwnerProjectUpdateDocument(projectId, updateId),
      getProjectAudiencePreview(projectId, "owner"),
    ])

    if (document.update.status !== "published") {
      notFound()
    }

    return { document, preview }
  } catch (error) {
    if (hasDigest(error) && error.digest === "NEXT_NOT_FOUND") throw error
    notFound()
  }
}

export default async function OwnerUpdatePreviewPage({
  params,
}: {
  readonly params: Promise<{
    readonly id: string
    readonly updateId: string
  }>
}): Promise<React.ReactElement> {
  const { id, updateId } = await params
  const { document, preview } = await loadOwnerUpdatePreview(id, updateId)
  const homeHref = projectAudiencePreviewHref(id, "owner")

  return (
    <ProjectAudiencePreviewShell
      audience="owner"
      projectId={preview.project.id}
      projectName={preview.project.name}
      projectNumber={preview.project.projectNumber}
      projectOptions={preview.projectOptions}
      viewer={preview.viewer}
      viewerIsInternal={preview.viewerIsInternal}
    >
      <OwnerUpdateDocument
        document={document}
        previewMode={{
          homeHref,
          photosHref: `${homeHref}#photos`,
        }}
      />
    </ProjectAudiencePreviewShell>
  )
}
