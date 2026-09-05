import * as React from "react"
import { createRoot } from "react-dom/client"
import {
  dashboardFinancials,
  dashboardFixture,
} from "./project-audience-dashboard"
import { ProjectAudienceDashboardView } from "@/components/projects/project-audience-dashboard-view"
import { ProjectAudiencePreviewShell } from "@/components/projects/project-audience-preview-shell"
import { projectAudienceMessageShortcut } from "@/lib/project-audience-direct-message"
import type { ProjectAudienceWorkspaceSection } from "@/lib/project-audience-preview-routes"

function Fixture(): React.ReactElement {
  const [location, setLocation] = React.useState(window.location.href)
  React.useEffect(() => {
    const update = (): void => setLocation(window.location.href)
    window.addEventListener("popstate", update)
    return () => window.removeEventListener("popstate", update)
  }, [])
  const url = new URL(location)
  const partner =
    url.pathname.includes("sub-vendor") ||
    url.searchParams.get("role") === "partner"
  const base = dashboardFixture(partner ? "sub_vendor" : "owner")
  const project = url.pathname.includes("meadow")
    ? base.projectOptions[1]
    : base.projectOptions[0]
  const projectId = project?.id ?? base.project.id
  const empty = url.searchParams.has("empty")
  const data = {
    ...base,
    viewerIsInternal: url.searchParams.has("internal"),
    project: {
      ...base.project,
      id: projectId,
      name: project?.name ?? base.project.name,
      projectNumber: project?.projectNumber ?? null,
    },
    photos: empty
      ? []
      : base.photos.map((photo) => ({
          ...photo,
          thumbnailUrl: `/api/projects/${projectId}/photos/${photo.id}?audience=${base.audience}`,
        })),
    scheduleItems: empty ? [] : base.scheduleItems,
    ownerUpdates: empty ? [] : base.ownerUpdates,
    contacts: empty ? [] : base.contacts,
    schedulePublicationAvailable: !empty,
  }
  const shortcut = projectAudienceMessageShortcut({
    projectId,
    audience: data.audience,
    viewerId: data.viewer.id,
    contacts: data.contacts,
    messageChannels: data.messageChannels,
  })
  const section: ProjectAudienceWorkspaceSection = url.pathname.endsWith(
    "/schedule"
  )
    ? "schedule"
    : "overview"
  return (
    <ProjectAudiencePreviewShell
      audience={data.audience}
      projectId={projectId}
      projectName={data.project.name}
      projectNumber={data.project.projectNumber}
      projectOptions={data.projectOptions}
      viewer={data.viewer}
      viewerIsInternal={data.viewerIsInternal}
      messageShortcut={shortcut}
      activeSection={section}
      warrantyEnabled={data.project.warrantyEnabled}
    >
      <ProjectAudienceDashboardView
        data={data}
        financials={
          empty
            ? { applications: null, changeOrders: null }
            : dashboardFinancials()
        }
        messageShortcut={shortcut}
        today="2026-09-08"
        greeting="Good morning"
      />
    </ProjectAudiencePreviewShell>
  )
}

const container = document.getElementById("root")
if (container) createRoot(container).render(<Fixture />)
