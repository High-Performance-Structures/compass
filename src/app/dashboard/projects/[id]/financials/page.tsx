export const dynamic = "force-dynamic"

import { decodeProjectRouteId } from "@/lib/project-route-id"
import { IconFileDollar } from "@tabler/icons-react"

import {
  getProjectFinancialCodingOptions,
  getProjectFinancialWorkflowItems,
  type ProjectFinancialCodingOptions,
  type ProjectFinancialWorkflowItem,
} from "@/app/actions/project-financial-workflows"
import {
  getSageSquareReceipts,
  type SquareReceiptListItem,
} from "@/app/actions/sage-square-receipts"
import { getProjects } from "@/app/actions/projects"
import { SquareReceiptsTable } from "@/components/financials/square-receipts-table"
import { PageHeader } from "@/components/page-header"
import { ProjectContextSwitcher } from "@/components/projects/project-context-switcher"
import { ProjectContextWatermarkShell } from "@/components/projects/project-context-watermark-shell"
import { ProjectFinancialWorkspace } from "@/components/projects/project-financial-workspace"

export default async function ProjectFinancialsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>
  readonly searchParams: Promise<{
    readonly squareReceipt?: string | readonly string[]
  }>
}): Promise<React.ReactElement> {
  const { id: rawProjectId } = await params
  const query = await searchParams
  const id = decodeProjectRouteId(rawProjectId)
  let items: readonly ProjectFinancialWorkflowItem[] = []
  let codingOptions: ProjectFinancialCodingOptions = {
    phases: [],
    costCodes: [],
  }
  let projectDriveFolderId: string | null = null
  let squareReceipts: readonly SquareReceiptListItem[] = []

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
  try {
    squareReceipts = await getSageSquareReceipts(id)
  } catch (error) {
    console.warn("Project Square receipts unavailable", error)
  }
  const selectedSquareReceipt = Array.isArray(query.squareReceipt)
    ? (query.squareReceipt[0] ?? null)
    : (query.squareReceipt ?? null)

  return (
    <ProjectContextWatermarkShell>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        <PageHeader
          back={{ href: `/dashboard/projects/${id}`, label: "Project" }}
          icon={<IconFileDollar className="size-5 text-primary" />}
          title="Project Financials"
          description="Current financial workflows and read-only historical owner billing records."
          actions={
            <ProjectContextSwitcher
              currentProjectId={id}
              targetSection="financials"
              placeholder="Switch financial project..."
              className="w-full sm:w-[280px]"
            />
          }
        />

        <div className="space-y-5">
          <SquareReceiptsTable
            receipts={squareReceipts}
            selectedReceiptId={selectedSquareReceipt}
          />
          <ProjectFinancialWorkspace
            projectId={id}
            items={items}
            phaseOptions={codingOptions.phases}
            costCodeOptions={codingOptions.costCodes}
            projectDriveFolderId={projectDriveFolderId}
          />
        </div>
      </div>
    </ProjectContextWatermarkShell>
  )
}
