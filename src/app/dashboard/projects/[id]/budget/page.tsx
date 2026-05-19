export const dynamic = "force-dynamic"

import Link from "next/link"
import {
  IconArrowLeft,
  IconEye,
  IconFileDollar,
  IconLock,
} from "@tabler/icons-react"

import {
  getProjectBudgetSummary,
  type ProjectBudgetSummary,
} from "@/app/actions/project-budget"
import {
  ProjectBudgetG703Table,
  ProjectBudgetPanel,
} from "@/components/projects/project-budget-panel"
import { Badge } from "@/components/ui/badge"

export default async function ProjectBudgetPage({
  params,
}: {
  readonly params: Promise<{ id: string }>
}): Promise<React.ReactElement> {
  const { id } = await params

  let internalBudget: ProjectBudgetSummary | null = null
  let ownerBudget: ProjectBudgetSummary | null = null

  try {
    internalBudget = await getProjectBudgetSummary(id, "internal")
    ownerBudget = await getProjectBudgetSummary(id, "owner")
  } catch (error) {
    console.warn("Budget unavailable", error)
  }

  return (
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
              Budget / G703
            </h1>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Internal Sage detail and owner-safe Schedule of Values view for this
            project.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">
            <IconLock className="mr-1 size-3" />
            Internal detail
          </Badge>
          <Badge variant="secondary">
            <IconEye className="mr-1 size-3" />
            Owner-filtered preview
          </Badge>
        </div>
      </div>

      <div className="mb-6">
        <ProjectBudgetPanel projectId={id} summary={internalBudget} />
      </div>

      {internalBudget && internalBudget.allLines.length > 0 && (
        <div className="mb-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Internal G703</h2>
              <p className="text-xs text-muted-foreground">
                All mapped lines, including internal-only details.
              </p>
            </div>
          </div>
          <ProjectBudgetG703Table summary={internalBudget} />
        </div>
      )}

      {ownerBudget && ownerBudget.allLines.length > 0 && (
        <div className="mb-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Owner View</h2>
              <p className="text-xs text-muted-foreground">
                O jobs show owner-approved cost-code detail. H jobs roll the
                owner view up to overall categories.
              </p>
            </div>
          </div>
          <ProjectBudgetG703Table summary={ownerBudget} />
        </div>
      )}
    </div>
  )
}
