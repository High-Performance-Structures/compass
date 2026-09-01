import { decodeProjectRouteId } from "@/lib/project-route-id"
import type * as React from "react"
import Link from "next/link"
import { IconArrowLeft } from "@tabler/icons-react"
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
import { Button } from "@/components/ui/button"
import { redirectIfFeaturePermissionDenied } from "@/lib/permission-redirect"
import { projectBrandFor } from "@/lib/project-branding"

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
  return project.projectNumber ? `${project.projectNumber} - ${project.name}` : project.name
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
  const brand = projectBrandFor({
    projectId: id,
    projectNumber: project?.projectNumber,
  })

  return (
    <ProjectContextWatermarkShell>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
            <Link href={`/dashboard/projects/${id}`}>
              <IconArrowLeft className="size-4" />
              Project
            </Link>
          </Button>
          <div className="flex items-center gap-3">
            <ProjectBrandLogo
              brand={brand}
              size={32}
              className="h-8 w-8 object-contain"
            />
            <h1 className="text-2xl font-semibold tracking-tight">
              Finish Selections
            </h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {label} room selections, supplier links, cost codes, and RFQ-ready
            items.
          </p>
        </div>
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
