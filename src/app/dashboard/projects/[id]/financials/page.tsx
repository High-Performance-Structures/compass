export const dynamic = "force-dynamic"

import { decodeProjectRouteId } from "@/lib/project-route-id"
import Link from "next/link"
import { IconArrowLeft, IconFileDollar } from "@tabler/icons-react"

import {
  getProjectFinancialCodingOptions,
  getProjectFinancialWorkflowItems,
  type ProjectFinancialCodingOptions,
  type ProjectFinancialWorkflowItem,
} from "@/app/actions/project-financial-workflows"
import { getProjects } from "@/app/actions/projects"
import { ProjectContextSwitcher } from "@/components/projects/project-context-switcher"
import { ProjectContextWatermarkShell } from "@/components/projects/project-context-watermark-shell"
import { ProjectFinancialWorkspace } from "@/components/projects/project-financial-workspace"

export default async function ProjectFinancialsPage({
  params,
}: {
  readonly params: Promise<{ id: string }>
}): Promise<React.ReactElement> {
  const { id: rawProjectId } = await params
  const id = decodeProjectRouteId(rawProjectId)
  let items: readonly ProjectFinancialWorkflowItem[] = []
  let codingOptions: ProjectFinancialCodingOptions = {
    phases: [],
    costCodes: [],
  }
  let projectDriveFolderId: string | null = null

  try {
    items = await getProjectFinancialWorkflowItems(id)
  } catch (error) {
    console.warn("Project financial workflow unavailable", error)
  }
  const projectOptions = await getProjects()
  projectDriveFolderId =
    projectOptions.find((project) => project.id === id)?.googleDriveFolderId ??
    null
  try {
    codingOptions = await getProjectFinancialCodingOptions(id)
  } catch (error) {
    console.warn("Project financial coding options unavailable", error)
  }

  return (
    <ProjectContextWatermarkShell>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link
              href={`/dashboard/projects/${id}`}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <IconArrowLeft className="size-4" />
              Project
            </Link>
            <div className="mt-3 flex items-center gap-2">
              <IconFileDollar className="size-5 text-primary" />
              <h1 className="text-2xl font-semibold tracking-tight">
                Project Financials
              </h1>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Current financial workflows and read-only historical owner
              billing records.
            </p>
          </div>
          <ProjectContextSwitcher
            currentProjectId={id}
            targetSection="financials"
            placeholder="Switch financial project..."
            className="w-full sm:w-[280px]"
          />
        </div>

        <ProjectFinancialWorkspace
          projectId={id}
          items={items}
          phaseOptions={codingOptions.phases}
          costCodeOptions={codingOptions.costCodes}
          projectDriveFolderId={projectDriveFolderId}
        />
      </div>
    </ProjectContextWatermarkShell>
  )
}
