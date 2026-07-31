import type * as React from "react"
import { notFound } from "next/navigation"

import { getProjectChangeOrder } from "@/app/actions/project-change-orders"
import { ProjectChangeOrderDetail } from "@/components/projects/project-change-order-detail"
import { redirectIfFeaturePermissionDenied } from "@/lib/permission-redirect"

export default async function ProjectChangeOrderDetailPage({
  params,
}: {
  readonly params: Promise<{
    readonly id: string
    readonly changeOrderId: string
  }>
}): Promise<React.ReactElement> {
  const { id, changeOrderId } = await params
  const item = await getProjectChangeOrder(id, changeOrderId).catch(
    (error: unknown) => {
      redirectIfFeaturePermissionDenied(error)
      throw error
    }
  )
  if (!item) notFound()

  const backHref =
    `/dashboard/projects/${encodeURIComponent(id)}/change-orders`
  return (
    <div className="flex-1 p-4 pt-6 sm:p-6 md:p-8">
      <ProjectChangeOrderDetail
        item={item}
        backHref={backHref}
        internal
      />
    </div>
  )
}
