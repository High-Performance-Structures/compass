export const dynamic = "force-dynamic"

import Link from "next/link"
import { IconArrowLeft, IconShoppingCartQuestion } from "@tabler/icons-react"

import {
  getProjectFinancialWorkflowItems,
  type ProjectFinancialWorkflowItem,
} from "@/app/actions/project-financial-workflows"
import { ProjectContextSwitcher } from "@/components/projects/project-context-switcher"
import { ProjectContextWatermarkShell } from "@/components/projects/project-context-watermark-shell"
import { ProjectFinancialWorkspace } from "@/components/projects/project-financial-workspace"

export default async function ProjectRfqsPage({
  params,
}: {
  readonly params: Promise<{ id: string }>
}): Promise<React.ReactElement> {
  const { id } = await params
  let items: readonly ProjectFinancialWorkflowItem[] = []

  try {
    items = await getProjectFinancialWorkflowItems(id)
  } catch (error) {
    console.warn("Project RFQ workflow unavailable", error)
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
              <IconShoppingCartQuestion className="size-5 text-primary" />
              <h1 className="text-2xl font-semibold tracking-tight">
                Requests for Quote
              </h1>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Draft vendor scopes, track response dates, and keep quote requests
              tied to the project.
            </p>
          </div>
          <ProjectContextSwitcher
            currentProjectId={id}
            targetSection="rfqs"
            placeholder="Switch RFQ project..."
            className="w-full sm:w-[280px]"
          />
        </div>

        <ProjectFinancialWorkspace projectId={id} items={items} mode="rfq" />
      </div>
    </ProjectContextWatermarkShell>
  )
}
