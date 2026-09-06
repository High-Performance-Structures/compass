import { decodeProjectRouteId } from "@/lib/project-route-id"
import type * as React from "react"
import Link from "next/link"
import { IconArrowLeft } from "@tabler/icons-react"

import {
  getProjectChangeOrderCapabilities,
  getProjectChangeOrderFormOptions,
  getProjectChangeOrders,
} from "@/app/actions/project-change-orders"
import { getProjectArchivedBuildertrendChangeOrders } from "@/app/actions/project-archived-change-orders"
import { getProjects } from "@/app/actions/projects"
import { ProjectArchivedChangeOrderSection } from "@/components/projects/project-archived-change-order-list"
import { ProjectChangeOrderList } from "@/components/projects/project-change-order-list"
import { ProjectQuickSwitcher } from "@/components/projects/project-quick-switcher"
import { Button } from "@/components/ui/button"
import { redirectIfFeaturePermissionDenied } from "@/lib/permission-redirect"

export default async function ProjectChangeOrdersPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}): Promise<React.ReactElement> {
  const { id: rawProjectId } = await params
  const id = decodeProjectRouteId(rawProjectId)
  const [projects, items, archived, capabilities, formOptions] = await Promise.all([
    getProjects(),
    getProjectChangeOrders(id),
    getProjectArchivedBuildertrendChangeOrders(id),
    getProjectChangeOrderCapabilities(id),
    getProjectChangeOrderFormOptions(id),
  ]).catch((error: unknown) => {
    redirectIfFeaturePermissionDenied(error)
    throw error
  })
  const project = projects.find((item) => item.id === id)
  const baseHref = `/dashboard/projects/${encodeURIComponent(id)}/change-orders`

  return (
    <div className="flex-1 space-y-5 p-4 pt-6 sm:p-6 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
            <Link href={`/dashboard/projects/${encodeURIComponent(id)}`}>
              <IconArrowLeft className="size-4" />
              Project
            </Link>
          </Button>
          <p className="text-sm text-muted-foreground">
            {project?.projectNumber ? `${project.projectNumber} · ` : ""}
            {project?.name ?? "Project"}
          </p>
        </div>
        <ProjectQuickSwitcher
          projects={projects}
          currentProjectId={id}
          targetSection="change-orders"
          placeholder="Switch change-order project..."
          className="w-full sm:w-[320px]"
        />
      </div>
      <ProjectChangeOrderList
        projectId={id}
        items={items}
        detailBaseHref={baseHref}
        internal
        formOptions={formOptions}
        canCreate={capabilities.canCreate}
      />
      <ProjectArchivedChangeOrderSection
        workspace={archived}
        detailBaseHref={baseHref}
      />
    </div>
  )
}
