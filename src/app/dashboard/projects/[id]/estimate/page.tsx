export const dynamic = "force-dynamic"

import { decodeProjectRouteId } from "@/lib/project-route-id"
import Link from "next/link"
import { IconCalculator, IconPackageExport } from "@tabler/icons-react"

import { getProjectEstimateWorkspace } from "@/app/actions/project-estimates"
import { getPublishedEstimateTemplateOptions } from "@/app/actions/estimate-templates"
import { getProjectFamilySummary } from "@/app/actions/project-families"
import { getProjectPhaseProposals } from "@/app/actions/estimate-phase-proposals"
import { PageHeader } from "@/components/page-header"
import { ProjectContextSwitcher } from "@/components/projects/project-context-switcher"
import { ProjectEstimateWorkspacePanel } from "@/components/projects/project-estimate-workspace"
import { ProjectEstimateList } from "@/components/projects/project-estimate-list"
import { getNuTechOrdersForEstimates } from "@/app/actions/nutech-orders"
import { getProjectPaperTrail } from "@/app/actions/paper-trail"
import { PaperTrailRecordStatus } from "@/components/paper-trail/paper-trail-record-status"

export default async function ProjectEstimatePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>
  readonly searchParams: Promise<{ estimateId?: string }>
}): Promise<React.ReactElement> {
  const [{ id: rawProjectId }, query] = await Promise.all([params, searchParams])
  const id = decodeProjectRouteId(rawProjectId)
  const [workspace, estimateTemplates, family, paperTrail, phaseProposals] = await Promise.all([
    getProjectEstimateWorkspace(id, query.estimateId),
    getPublishedEstimateTemplateOptions(),
    getProjectFamilySummary(id),
    getProjectPaperTrail(id, "estimate"),
    getProjectPhaseProposals(id),
  ])
  const activeEstimateId = workspace.activeEstimate?.id ?? null
  // Nu-Tech jobs show which order fills each estimate.
  const nuTechOrders =
    workspace.department === "N" && workspace.estimateMode === "multiple" ? await getNuTechOrdersForEstimates(id) : undefined

  return (
    <div className="compass-content-scroll min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
      <PageHeader
        back={{ href: `/dashboard/projects/${id}`, label: "Project" }}
        icon={<IconCalculator className="size-5 text-primary" />}
        title="Estimate"
        actions={
          <>
            {workspace.department === "N" && (
              <Link
                href={`/dashboard/projects/${id}/nutech`}
                className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium hover:bg-accent"
              >
                <IconPackageExport className="size-4" />
                Nu-Tech process
              </Link>
            )}
            <ProjectContextSwitcher currentProjectId={id} targetSection="estimate" placeholder="Switch estimate project..." className="w-full sm:w-[280px]" />
          </>
        }
      />
      {paperTrail.enabled && activeEstimateId ? (
        <PaperTrailRecordStatus
          className="-mt-3 mb-4"
          projectId={id}
          recordType="estimate"
          recordId={activeEstimateId}
          record={paperTrail.records[activeEstimateId] ?? null}
        />
      ) : null}
      {workspace.estimateMode === "multiple" && workspace.estimates.length > 0 ? (
        <ProjectEstimateList
          projectId={id}
          estimates={workspace.estimates}
          activeEstimateId={activeEstimateId}
          canEdit={workspace.canEdit}
          orders={nuTechOrders}
        />
      ) : null}
      <ProjectEstimateWorkspacePanel
        projectId={id}
        workspace={workspace}
        estimateTemplates={estimateTemplates}
        family={family}
        phaseProposals={phaseProposals}
      />
    </div>
  )
}
