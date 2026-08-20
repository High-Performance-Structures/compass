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
import { getProjects, type ProjectListItem } from "@/app/actions/projects"
import {
  getSagePayApplicationSyncState,
  type SagePayApplicationSyncState,
} from "@/app/actions/sage-pay-applications"
import {
  ProjectBudgetG703Table,
  ProjectBudgetPanel,
} from "@/components/projects/project-budget-panel"
import { ProjectBrandContactDetails } from "@/components/projects/project-brand-contact-details"
import { ProjectBrandLogo } from "@/components/projects/project-brand-logo"
import { ProjectBudgetPrintButton } from "@/components/projects/project-budget-print-button"
import { ProjectContextSwitcher } from "@/components/projects/project-context-switcher"
import { SagePayApplicationSyncControl } from "@/components/projects/sage-pay-application-sync-control"
import { Badge } from "@/components/ui/badge"
import { projectBrandFor } from "@/lib/project-branding"

export default async function ProjectBudgetPage({
  params,
}: {
  readonly params: Promise<{ id: string }>
}): Promise<React.ReactElement> {
  const { id } = await params

  let internalBudget: ProjectBudgetSummary | null = null
  let ownerBudget: ProjectBudgetSummary | null = null
  let sageSyncState: SagePayApplicationSyncState | null = null
  let project: ProjectListItem | null = null

  try {
    const [internal, owner, projectOptions] = await Promise.all([
      getProjectBudgetSummary(id, "internal"),
      getProjectBudgetSummary(id, "owner"),
      getProjects(),
    ])
    internalBudget = internal
    ownerBudget = owner
    project = projectOptions.find((option) => option.id === id) ?? null
  } catch (error) {
    console.warn("Budget unavailable", error)
  }
  try {
    sageSyncState = await getSagePayApplicationSyncState(id)
  } catch (error) {
    console.warn("Sage sync unavailable", error)
  }
  const brand = projectBrandFor({
    projectId: id,
    projectNumber: project?.projectNumber ?? null,
  })

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
            Internal budget detail and owner-safe Schedule of Values.
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          <ProjectContextSwitcher
            currentProjectId={id}
            targetSection="budget"
            placeholder="Switch budget project..."
            className="w-full sm:w-[280px]"
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Badge variant="outline">
              <IconLock className="mr-1 size-3" />
              Internal detail
            </Badge>
            <Badge variant="secondary">
              <IconEye className="mr-1 size-3" />
              Owner view
            </Badge>
          </div>
        </div>
      </div>

      {sageSyncState && (
        <SagePayApplicationSyncControl
          projectId={id}
          state={sageSyncState}
        />
      )}

      <div className="mb-6">
        <ProjectBudgetPanel
          projectId={id}
          summary={internalBudget}
          detailHref={null}
          divisionLimit={null}
        />
      </div>

      {internalBudget && internalBudget.allLines.length > 0 && (
        <div
          className="mb-6"
          data-project-budget-print-source="true"
        >
          <header className="hidden border-b pb-3 print:flex print:items-start print:justify-between print:gap-4">
            <div className="flex items-center gap-3">
              <ProjectBrandLogo
                brand={brand}
                size={56}
                className="size-14 object-contain"
              />
              <div>
                <p className="text-lg font-semibold">{brand.companyName}</p>
                <ProjectBrandContactDetails
                  brand={brand}
                  lineClassName="text-xs"
                />
                <p className="text-sm text-muted-foreground">
                  {project?.projectNumber ?? project?.name ?? "Project"}
                </p>
              </div>
            </div>
            <div className="text-right text-xs">
              <p className="font-semibold">Internal G703 Schedule of Values</p>
              <p className="mt-1 text-muted-foreground">
                {internalBudget.currentApplication
                  ? `Pay application ${internalBudget.currentApplication.applicationNumber}`
                  : "Current budget"}
              </p>
            </div>
          </header>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Internal G703</h2>
              <p className="text-xs text-muted-foreground">
                All mapped lines and internal-only detail. Page access follows
                the Budget / G703 permission; each Owner/Internal badge is
                stored on its individual budget line.
              </p>
            </div>
            <div className="print:hidden">
              <ProjectBudgetPrintButton />
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
                O jobs show approved cost-code detail. H jobs roll up to
                categories.
              </p>
            </div>
          </div>
          <ProjectBudgetG703Table summary={ownerBudget} />
        </div>
      )}
    </div>
  )
}
