import type * as React from "react"
import { getSelectionWorkspace } from "@/app/actions/selection-decisions-read"
import { selectionDashboardSummary } from "@/lib/selections/dashboard"

import type { ProjectAudiencePreview } from "@/app/actions/project-audience-preview"
import { getProjectBudgetSummary } from "@/app/actions/project-budget"
import { getProjectChangeOrders } from "@/app/actions/project-change-orders"
import { ProjectAudienceDashboardView } from "@/components/projects/project-audience-dashboard-view"
import { audienceDashboardDate } from "@/lib/project-audience-dashboard"
import type { ProjectAudienceMessageShortcut } from "@/lib/project-audience-direct-message"
import { getAudienceJobMap } from "@/lib/portfolio-map/audience"
import { VendorJobMap } from "@/components/projects/vendor-job-map"
import { OwnerSiteRelief } from "@/components/projects/owner-site-relief"
import { ownerScheduleProgress } from "@/lib/portfolio-map/audience-model"

export async function ProjectAudienceDashboard({
  data,
  messageShortcut,
}: {
  readonly data: ProjectAudiencePreview
  readonly messageShortcut: ProjectAudienceMessageShortcut | null
}): Promise<React.ReactElement> {
  // Keep the same audience-aware readers used by the destination pages. A failed
  // optional summary must not block project navigation or look like a zero count.
  const [changes, budget, selections, mapJobs] = await Promise.allSettled([
    getProjectChangeOrders(data.project.id, data.audience),
    data.audience === "owner"
      ? getProjectBudgetSummary(data.project.id, "owner")
      : Promise.resolve(null),
    data.audience === "owner"
      ? getSelectionWorkspace(data.project.id, "owner")
      : Promise.resolve(null),
    // Owners: their current project. Vendors: only the jobs already in their
    // project switcher.
    data.audience === "owner"
      ? getAudienceJobMap([data.project.id])
      : data.projectOptions.length > 1
        ? getAudienceJobMap(data.projectOptions.map((option) => option.id))
        : Promise.resolve([]),
  ])
  const jobs = mapJobs.status === "fulfilled" ? mapJobs.value : []
  const ownerJob = data.audience === "owner" ? jobs[0] : undefined
  const mapSection = ownerJob ? (
    <OwnerSiteRelief job={ownerJob} progress={ownerScheduleProgress(data.scheduleItems)} />
  ) : data.audience === "sub_vendor" && jobs.length > 1 ? (
    <VendorJobMap jobs={jobs} currentProjectId={data.project.id} />
  ) : null
  const date = audienceDashboardDate(new Date())
  return (
    <ProjectAudienceDashboardView
      selectionSummary={
        selections.status === "fulfilled" && selections.value
          ? selectionDashboardSummary(selections.value)
          : { kind: "unavailable" }
      }
      data={data}
      messageShortcut={messageShortcut}
      today={date.today}
      greeting={date.greeting}
      mapSection={mapSection}
      financials={{
        changeOrders: changes.status === "fulfilled" ? changes.value : null,
        applications:
          budget.status === "fulfilled"
            ? (budget.value?.applications ?? [])
            : null,
      }}
    />
  )
}
