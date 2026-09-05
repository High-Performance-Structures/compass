import type * as React from "react"
import { getSelectionWorkspace } from "@/app/actions/selection-decisions-read"
import { selectionDashboardSummary } from "@/lib/selections/dashboard"

import type { ProjectAudiencePreview } from "@/app/actions/project-audience-preview"
import { getProjectBudgetSummary } from "@/app/actions/project-budget"
import { getProjectChangeOrders } from "@/app/actions/project-change-orders"
import { ProjectAudienceDashboardView } from "@/components/projects/project-audience-dashboard-view"
import { audienceDashboardDate } from "@/lib/project-audience-dashboard"
import type { ProjectAudienceMessageShortcut } from "@/lib/project-audience-direct-message"

export async function ProjectAudienceDashboard({
  data,
  messageShortcut,
}: {
  readonly data: ProjectAudiencePreview
  readonly messageShortcut: ProjectAudienceMessageShortcut | null
}): Promise<React.ReactElement> {
  // Keep the same audience-aware readers used by the destination pages. A failed
  // optional summary must not block project navigation or look like a zero count.
  const [changes, budget, selections] = await Promise.allSettled([
    getProjectChangeOrders(data.project.id, data.audience),
    data.audience === "owner"
      ? getProjectBudgetSummary(data.project.id, "owner")
      : Promise.resolve(null),
    data.audience === "owner"
      ? getSelectionWorkspace(data.project.id, "owner")
      : Promise.resolve(null),
  ])
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
