import { currentDepartmentProfiles } from "@/lib/department-profiles-server"
import { getSelectionWorkspace } from "@/app/actions/selection-decisions-read"
import { PageHeader } from "@/components/page-header"
import { SelectionDecisionWorkspace } from "@/components/selections/selection-decision-workspace"
import { decodeProjectRouteId } from "@/lib/project-route-id"
import type * as React from "react"
import Link from "next/link"
import { notFound } from "next/navigation"

import {
  getProjectSelectionOptions,
  getProjectSelections,
  type ProjectSelectionOptions,
  type ProjectSelectionsSummary,
} from "@/app/actions/project-selections"
import { getProjects } from "@/app/actions/projects"
import { ProjectBrandLogo } from "@/components/projects/project-brand-logo"
import { ProjectContextWatermarkShell } from "@/components/projects/project-context-watermark-shell"
import { ProjectQuickSwitcher } from "@/components/projects/project-quick-switcher"
import { ProjectSelectionsWorkspace } from "@/components/projects/project-selections-workspace"
import { DeveloperOnly } from "@/components/developer-mode-provider"
import { Badge } from "@/components/ui/badge"
import { redirectIfFeaturePermissionDenied } from "@/lib/permission-redirect"
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
}: {
  readonly params: Promise<{ readonly id: string }>
}): Promise<React.ReactElement> {
  const { id: rawProjectId } = await params
  const id = decodeProjectRouteId(rawProjectId)
  let summary: ProjectSelectionsSummary
  let selectionOptions: ProjectSelectionOptions

  try {
    ;[summary, selectionOptions] = await Promise.all([
      getProjectSelections(id),
      getProjectSelectionOptions(id),
    ])
  } catch (error) {
    if (hasDigest(error)) throw error
    redirectIfFeaturePermissionDenied(error)
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
      <SelectionDecisionWorkspace
        workspace={await getSelectionWorkspace(id, "staff")}
      />
      <div className="mt-8 border-t pt-6">
        <h2 className="text-lg font-semibold">Edit finish specifications</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Maintain products, rooms, quantities, and internal notes below.
          Publish changes in Selections & Decisions above.
        </p>
      </div>
      <ProjectSelectionsWorkspace
        brand={brand}
        clientName={project?.clientName ?? null}
        projectLabel={label}
        projectId={id}
        options={selectionOptions}
        summary={summary}
      />
    </ProjectContextWatermarkShell>
  )
}
