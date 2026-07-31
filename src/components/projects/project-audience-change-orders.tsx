import type * as React from "react"
import { notFound } from "next/navigation"

import {
  getProjectChangeOrder,
  getProjectChangeOrderCapabilities,
  getProjectChangeOrders,
} from "@/app/actions/project-change-orders"
import {
  getProjectAudiencePreview,
  type ProjectAudiencePreview,
} from "@/app/actions/project-audience-preview"
import { ProjectAudiencePreviewShell } from "@/components/projects/project-audience-preview-shell"
import { ProjectChangeOrderDetail } from "@/components/projects/project-change-order-detail"
import { ProjectChangeOrderList } from "@/components/projects/project-change-order-list"
import type { ProjectAudience } from "@/lib/project-audience-access"
import { projectAudienceMessageShortcut } from "@/lib/project-audience-direct-message"
import { projectAudienceSectionHref } from "@/lib/project-audience-preview-routes"

function routeAudience(audience: ProjectAudience): "owner" | "sub-vendor" {
  return audience === "owner" ? "owner" : "sub-vendor"
}

function hasDigest(error: unknown): error is { readonly digest: string } {
  return typeof error === "object" && error !== null && "digest" in error
}

async function loadPreview(
  projectId: string,
  audience: ProjectAudience
): Promise<ProjectAudiencePreview> {
  try {
    return await getProjectAudiencePreview(projectId, audience)
  } catch (error) {
    if (hasDigest(error) && error.digest === "NEXT_NOT_FOUND") throw error
    notFound()
  }
}

export async function ProjectAudienceChangeOrders({
  projectId,
  audience,
  changeOrderId,
}: {
  readonly projectId: string
  readonly audience: ProjectAudience
  readonly changeOrderId?: string
}): Promise<React.ReactElement> {
  const preview = await loadPreview(projectId, audience)
  const route = routeAudience(audience)
  const baseHref = projectAudienceSectionHref(
    projectId,
    route,
    "change-orders"
  )
  const item = changeOrderId
    ? await getProjectChangeOrder(projectId, changeOrderId, audience)
    : null
  const items = changeOrderId
    ? []
    : await getProjectChangeOrders(projectId, audience)
  const capabilities = await getProjectChangeOrderCapabilities(projectId)
  const messageShortcut = projectAudienceMessageShortcut({
    projectId: preview.project.id,
    audience,
    viewerId: preview.viewer.id,
    contacts: preview.contacts,
    messageChannels: preview.messageChannels,
  })
  if (changeOrderId && !item) notFound()

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
      activeSection="change-orders"
    >
      <main className="min-h-screen bg-muted/20 px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          {item ? (
            <ProjectChangeOrderDetail
              item={item}
              backHref={baseHref}
              internal={false}
            />
          ) : (
            <ProjectChangeOrderList
              projectId={projectId}
              items={items}
              detailBaseHref={baseHref}
              internal={false}
              canCreate={
                !preview.viewerIsInternal && capabilities.canCreate
              }
            />
          )}
        </div>
      </main>
    </ProjectAudiencePreviewShell>
  )
}
