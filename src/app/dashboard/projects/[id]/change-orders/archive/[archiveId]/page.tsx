import type * as React from "react"
import { notFound } from "next/navigation"

import { getProjectArchivedBuildertrendChangeOrder } from "@/app/actions/project-archived-change-orders"
import { ProjectArchivedChangeOrderDetail } from "@/components/projects/project-archived-change-order-detail"
import { redirectIfFeaturePermissionDenied } from "@/lib/permission-redirect"
import { decodeProjectRouteId } from "@/lib/project-route-id"

export default async function ProjectArchivedChangeOrderDetailPage({
  params,
}: {
  readonly params: Promise<{
    readonly id: string
    readonly archiveId: string
  }>
}): Promise<React.ReactElement> {
  const { id: rawProjectId, archiveId } = await params
  const projectId = decodeProjectRouteId(rawProjectId)
  const record = await getProjectArchivedBuildertrendChangeOrder(
    projectId,
    archiveId
  ).catch((error: unknown) => {
    redirectIfFeaturePermissionDenied(error)
    throw error
  })
  if (!record) notFound()

  return (
    <div className="flex-1 p-4 pt-6 sm:p-6 md:p-8">
      <ProjectArchivedChangeOrderDetail
        record={record}
        backHref={`/dashboard/projects/${encodeURIComponent(projectId)}/change-orders`}
      />
    </div>
  )
}
