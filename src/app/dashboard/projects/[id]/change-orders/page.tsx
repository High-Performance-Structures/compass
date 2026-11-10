import { decodeProjectRouteId } from "@/lib/project-route-id"
import type * as React from "react"
import Link from "next/link"
import { IconArrowLeft } from "@tabler/icons-react"

import {
  getProjectChangeOrderCapabilities,
  getProjectChangeOrderFormOptions,
  getProjectChangeOrders,
} from "@/app/actions/project-change-orders"
import { getProjects } from "@/app/actions/projects"
import { getProjectVarianceOptions } from "@/app/actions/project-variances"
import { ProjectChangeOrderList } from "@/components/projects/project-change-order-list"
import { ProjectChangeOrderStaffDetail } from "@/components/projects/project-change-order-staff-detail"
import { RouteRecordDrawer } from "@/components/record-drawer"
import { parseChangeOrderListFilter } from "@/lib/change-orders/record-list"
import { listSheetStartFilter } from "@/lib/domain/settings/list-sheets"
import { ProjectQuickSwitcher } from "@/components/projects/project-quick-switcher"
import { Button } from "@/components/ui/button"
import { permissionDeniedRedirectHref } from "@/lib/permission-redirect"
import { ClientRedirect } from "@/components/client-redirect"

export default async function ProjectChangeOrdersPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly id: string }>
  readonly searchParams: Promise<{ readonly item?: string | readonly string[] }>
}): Promise<React.ReactElement> {
  const { id: rawProjectId } = await params
  const query = await searchParams
  const openItemId = (Array.isArray(query.item) ? query.item[0] : query.item) ?? null
  const id = decodeProjectRouteId(rawProjectId)
  // A permission denial sends the browser to the access page instead.
  const loaded = await Promise.all([
    getProjects(),
    getProjectChangeOrders(id),
    getProjectChangeOrderCapabilities(id),
    getProjectChangeOrderFormOptions(id),
    getProjectVarianceOptions(id),
  ]).then(
    (data) => ({ data, deniedHref: null }),
    (error: unknown) => {
      const deniedHref = permissionDeniedRedirectHref(error)
      if (deniedHref) return { data: null, deniedHref }
      throw error
    },
  )
  if (loaded.data === null) return <ClientRedirect href={loaded.deniedHref} />
  const [projects, items, capabilities, formOptions, varianceOptions] = loaded.data
  // The sheet opens on the company's filter (Settings › Lists).
  const initialFilter = parseChangeOrderListFilter(await listSheetStartFilter("change-orders.job"))
  const project = projects.find((item) => item.id === id)
  const baseHref = `/dashboard/projects/${encodeURIComponent(id)}/change-orders`
  // The change order opened from the list shows in the record drawer.
  const openItem = openItemId ? items.find((item) => item.id === openItemId) ?? null : null
  const openDetail = openItem
    ? await ProjectChangeOrderStaffDetail({ projectId: id, changeOrderId: openItem.id, backHref: null })
    : null

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
        varianceOptions={varianceOptions}
        initialFilter={initialFilter}
        openInDrawer
      />
      {openItem && openDetail ? (
        <RouteRecordDrawer
          key={openItem.id}
          closeHref={baseHref}
          title={`${openItem.changeOrderNumber} · ${openItem.title}`}
          hideHeader
          footer={
            <Button asChild variant="link" className="px-0">
              <Link href={`${baseHref}/${encodeURIComponent(openItem.id)}`}>Open full page →</Link>
            </Button>
          }
        >
          {openDetail}
        </RouteRecordDrawer>
      ) : null}
    </div>
  )
}
