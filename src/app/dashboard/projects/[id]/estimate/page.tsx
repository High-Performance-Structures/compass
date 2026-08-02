export const dynamic = "force-dynamic"

import Link from "next/link"
import { IconArrowLeft, IconCalculator } from "@tabler/icons-react"

import { getProjectEstimateWorkspace } from "@/app/actions/project-estimates"
import { ProjectContextSwitcher } from "@/components/projects/project-context-switcher"
import { ProjectEstimateWorkspacePanel } from "@/components/projects/project-estimate-workspace"

export default async function ProjectEstimatePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>
  readonly searchParams: Promise<{ estimateId?: string }>
}): Promise<React.ReactElement> {
  const [{ id }, query] = await Promise.all([params, searchParams])
  const workspace = await getProjectEstimateWorkspace(id, query.estimateId)

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
            Division-first CA22 estimate, contract basis, Foxit approval, and Sage-ready budget handoff.
          </p>
        </div>
        <ProjectContextSwitcher currentProjectId={id} targetSection="estimate" placeholder="Switch estimate project..." className="w-full sm:w-[280px]" />
      </div>
      <ProjectEstimateWorkspacePanel projectId={id} workspace={workspace} />
    </div>
  )
}
