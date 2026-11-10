import { currentDepartmentProfiles } from "@/lib/department-profiles-server"
import { getSelectionWorkspace } from "@/app/actions/selection-decisions-read"
import { getSelectionSheet, type SelectionSheetData } from "@/app/actions/selection-choices"
import { SelectionsSheet } from "@/components/selections/selections-sheet"
import { listSheetStartFilter } from "@/lib/domain/settings/list-sheets"
import { parseSelectionListFilter } from "@/lib/selections/sheet"
import { PageHeader } from "@/components/page-header"
import { SelectionsWorkAreas } from "@/components/selections/selections-work-areas"
import { parseSelectionWorkArea } from "@/lib/selections/work-areas"
import { decodeProjectRouteId } from "@/lib/project-route-id"
import type * as React from "react"
import Link from "next/link"
import { notFound } from "next/navigation"

import {
  getProjectSelectionOptions,
  getProjectSelections,
} from "@/app/actions/project-selections"
import type {
  ProjectSelectionOptions,
  ProjectSelectionsSummary,
} from "@/lib/domain/selections/types"
import { getProjects } from "@/app/actions/projects"
import { ProjectBrandLogo } from "@/components/projects/project-brand-logo"
import { ProjectContextWatermarkShell } from "@/components/projects/project-context-watermark-shell"
import { ProjectQuickSwitcher } from "@/components/projects/project-quick-switcher"
import { DeveloperOnly } from "@/components/developer-mode-provider"
import { Badge } from "@/components/ui/badge"
import { permissionDeniedRedirectHref } from "@/lib/permission-redirect"
import { ClientRedirect } from "@/components/client-redirect"
import { projectBrandFor } from "@/lib/project-branding"
import { projectNumberAndName } from "@/lib/project-display-name"

export const dynamic = "force-dynamic"

function hasDigest(error: unknown): error is { readonly digest: string } {
  return typeof error === "object" && error !== null && "digest" in error
}

function isProjectNotFound(error: unknown): boolean {
  return error instanceof Error && error.message === "Project not found"
}

function projectLabel(
  project:
    | {
        readonly name: string
        readonly projectNumber: string | null
      }
    | undefined
): string {
  if (!project) return "Project"
  return project.projectNumber
    ? projectNumberAndName(project, " - ")
    : project.name
}

export default async function ProjectSelectionsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly id: string }>
  readonly searchParams: Promise<{
    readonly status?: string
    readonly item?: string
    readonly selection?: string
    /** The "Work on" area: sheet (default), publish, specs or share. */
    readonly work?: string
  }>
}): Promise<React.ReactElement> {
  const { id: rawProjectId } = await params
  const query = await searchParams
  const id = decodeProjectRouteId(rawProjectId)
  let summary: ProjectSelectionsSummary
  let selectionOptions: ProjectSelectionOptions
  let sheet: SelectionSheetData

  try {
    ;[summary, selectionOptions, sheet] = await Promise.all([
      getProjectSelections(id),
      getProjectSelectionOptions(id),
      getSelectionSheet(id),
    ])
  } catch (error) {
    if (hasDigest(error)) throw error
    const deniedHref = permissionDeniedRedirectHref(error)
    if (deniedHref) return <ClientRedirect href={deniedHref} />
    if (isProjectNotFound(error)) notFound()
    throw error
  }

  const projects = await getProjects()
  const project = projects.find((item) => item.id === id)
  const label = projectLabel(project)
  const brand = projectBrandFor({ profiles: await currentDepartmentProfiles(),
    projectId: id,
    projectNumber: project?.projectNumber,
  })

  return (
    <ProjectContextWatermarkShell>
      <PageHeader
        back={{ href: `/dashboard/projects/${id}`, label: "Project" }}
        icon={<ProjectBrandLogo brand={brand} size={32} className="h-8 w-8 object-contain" />}
        title="Finish Selections"
        actions={
          <>
            <div className="flex flex-col items-stretch gap-2 sm:items-end">
              <ProjectQuickSwitcher
                projects={projects}
                currentProjectId={id}
                targetSection="selections"
                placeholder="Switch selections project..."
                className="w-full sm:w-[300px]"
              />
              <div className="flex flex-wrap justify-end gap-2">
                <Badge variant="secondary">
                  {summary.roomCount} room{summary.roomCount === 1 ? "" : "s"}
                </Badge>
                {summary.sourceWorkbookCount > 0 && (
                  <DeveloperOnly>
                    <Badge variant="outline">
                      {summary.sourceWorkbookCount} workbook
                      {summary.sourceWorkbookCount === 1 ? "" : "s"}
                    </Badge>
                  </DeveloperOnly>
                )}
                <Badge variant="secondary">{summary.totalCount} total</Badge>
                <Badge variant="outline">
                  {summary.needsDecisionCount} need decision
                </Badge>
                <Badge variant="outline">{summary.approvedCount} approved</Badge>
                <Badge variant="outline">{summary.pricingCount} pricing</Badge>
                <Badge variant="outline">{summary.orderedCount} ordered</Badge>
              </div>
            </div>
          </>
        }
      />

      <Link
        href={`/preview/projects/${id}/owner/selections`}
        className="inline-block text-sm text-primary underline"
      >
        Open owner selections preview →
      </Link>
      <SelectionsWorkAreas
        // A record link (`?item=`) opens in the sheet, so it wins over `?work=`.
        initialArea={query.item || query.selection ? "sheet" : parseSelectionWorkArea(query.work)}
        sheet={
          <SelectionsSheet
            projectId={id}
            rows={sheet.rows}
            suppliers={sheet.suppliers}
            rounds={sheet.rounds}
            statusLabels={sheet.statusLabels}
            leadTimeWarnings={sheet.leadTimeWarnings}
            initialFilter={parseSelectionListFilter(query.status ?? (await listSheetStartFilter("selections.job")))}
            // `?item=` is the standard record link; `?selection=` is the older Save to Compass link.
            initialOpenId={query.item ?? query.selection ?? null}
            createOptions={selectionOptions}
          />
        }
        workspace={await getSelectionWorkspace(id, "staff")}
        summary={summary}
        options={selectionOptions}
        leadTimeWarnings={sheet.leadTimeWarnings}
        brand={brand}
        clientName={project?.clientName ?? null}
        projectId={id}
        projectLabel={label}
      />
    </ProjectContextWatermarkShell>
  )
}
