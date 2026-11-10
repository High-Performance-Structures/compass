export const dynamic = "force-dynamic"

import { currentDepartmentProfiles } from "@/lib/department-profiles-server"
import { requireProjectRouteId } from "@/lib/project-route-id"
import type * as React from "react"
import Link from "next/link"

import { getOwnerProjectUpdateDocument } from "@/app/actions/project-field"
import { OwnerUpdateDocument } from "@/components/projects/owner-update-document"
import { ProjectAudienceWorkspaceRoute } from "@/components/projects/project-audience-workspace-route"
import { RouteRecordDrawer } from "@/components/record-drawer"
import { Button } from "@/components/ui/button"
import {
  ownerUpdatePreviewHref,
  projectAudiencePreviewHref,
  projectAudienceSectionHref,
} from "@/lib/project-audience-preview-routes"

export default async function OwnerUpdatesPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly id: string }>
  readonly searchParams: Promise<{ readonly item?: string | readonly string[] }>
}): Promise<React.ReactElement> {
  const { id: rawProjectId } = await params
  const query = await searchParams
  const openItemId = (Array.isArray(query.item) ? query.item[0] : query.item) ?? null
  const id = await requireProjectRouteId(rawProjectId)
  // The update opened from the list (`?item=`) shows in the record drawer;
  // drafts and updates the owner cannot see simply don't open.
  const openDocument = openItemId
    ? await getOwnerProjectUpdateDocument(id, openItemId)
        .then((document) => (document.update.status === "published" ? document : null))
        .catch(() => null)
    : null

  return (
    <>
      <ProjectAudienceWorkspaceRoute
        projectId={id}
        audience="owner"
        section="updates"
      />
      {openDocument ? (
        <RouteRecordDrawer
          key={openDocument.update.id}
          closeHref={projectAudienceSectionHref(id, "owner", "updates")}
          title={openDocument.update.title}
          hideHeader
          footer={
            <Button asChild variant="link" className="px-0">
              <Link href={ownerUpdatePreviewHref(id, openDocument.update.id)}>Open full page →</Link>
            </Button>
          }
        >
          <OwnerUpdateDocument
            profiles={await currentDepartmentProfiles()}
            document={openDocument}
            inDrawer
            previewMode={{
              homeHref: projectAudiencePreviewHref(id, "owner"),
              photosHref: projectAudienceSectionHref(id, "owner", "photos"),
            }}
          />
        </RouteRecordDrawer>
      ) : null}
    </>
  )
}
