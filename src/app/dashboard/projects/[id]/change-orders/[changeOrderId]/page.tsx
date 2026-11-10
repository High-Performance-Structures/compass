import { decodeProjectRouteId } from "@/lib/project-route-id"
import type * as React from "react"
import { notFound } from "next/navigation"

import { ProjectChangeOrderStaffDetail } from "@/components/projects/project-change-order-staff-detail"

export default async function ProjectChangeOrderDetailPage({
  params,
}: {
  readonly params: Promise<{
    readonly id: string
    readonly changeOrderId: string
  }>
}): Promise<React.ReactElement> {
  const { id: rawProjectId, changeOrderId } = await params
  const id = decodeProjectRouteId(rawProjectId)
  const detail = await ProjectChangeOrderStaffDetail({
    projectId: id,
    changeOrderId,
    backHref: `/dashboard/projects/${encodeURIComponent(id)}/change-orders`,
  })
  if (!detail) notFound()
  return <div className="flex-1 p-4 pt-6 sm:p-6 md:p-8">{detail}</div>
}
