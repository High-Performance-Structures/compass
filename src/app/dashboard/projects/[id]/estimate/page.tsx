export const dynamic = "force-dynamic"

import { decodeProjectRouteId } from "@/lib/project-route-id"
import Link from "next/link"
import { IconArrowLeft, IconCalculator, IconPackageExport } from "@tabler/icons-react"

import { getProjectEstimateWorkspace } from "@/app/actions/project-estimates"
import { getPublishedEstimateTemplateOptions } from "@/app/actions/estimate-templates"
import { ProjectContextSwitcher } from "@/components/projects/project-context-switcher"
import { ProjectEstimateWorkspacePanel } from "@/components/projects/project-estimate-workspace"

export default async function ProjectEstimatePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>
  readonly searchParams: Promise<{ estimateId?: string }>
}): Promise<React.ReactElement> {
  const [{ id: rawProjectId }, query] = await Promise.all([params, searchParams])
  const id = decodeProjectRouteId(rawProjectId)
  const [workspace, estimateTemplates] = await Promise.all([
    getProjectEstimateWorkspace(id, query.estimateId),
    getPublishedEstimateTemplateOptions(),
  ])

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={`/dashboard/projects/${id}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <IconArrowLeft className="size-4" />Project
          </Link>
          <div className="mt-3 flex items-center gap-2">
            <IconCalculator className="size-5 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">Estimate</h1>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Department-specific client estimate, contract basis, approval, and budget handoff.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
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
        </div>
      </div>
      <ProjectEstimateWorkspacePanel
        projectId={id}
        workspace={workspace}
        estimateTemplates={estimateTemplates}
      />
    </div>
  )
}
