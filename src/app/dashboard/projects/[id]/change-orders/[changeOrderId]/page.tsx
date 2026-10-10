import { decodeProjectRouteId } from "@/lib/project-route-id"
import type * as React from "react"
import { notFound } from "next/navigation"

import {
  getProjectChangeOrder,
  getProjectChangeOrderFormOptions,
} from "@/app/actions/project-change-orders"
import { ProjectChangeOrderDetail } from "@/components/projects/project-change-order-detail"
import { redirectIfFeaturePermissionDenied } from "@/lib/permission-redirect"
import { getProjectPaperTrail } from "@/app/actions/paper-trail"
import { PaperTrailRecordStatus } from "@/components/paper-trail/paper-trail-record-status"

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
  const [item, formOptions, paperTrail] = await Promise.all([
    getProjectChangeOrder(id, changeOrderId),
    getProjectChangeOrderFormOptions(id),
    getProjectPaperTrail(id, "change_order"),
  ]).catch((error: unknown) => {
    redirectIfFeaturePermissionDenied(error)
    throw error
  })
  if (!item) notFound()

  const backHref =
    `/dashboard/projects/${encodeURIComponent(id)}/change-orders`
  return (
    <div className="flex-1 p-4 pt-6 sm:p-6 md:p-8">
      <ProjectChangeOrderDetail
        item={item}
        backHref={backHref}
        internal
        formOptions={formOptions}
        paperTrailStatus={
          paperTrail.enabled ? (
            <PaperTrailRecordStatus
              projectId={id}
              recordType="change_order"
              recordId={changeOrderId}
              record={paperTrail.records[changeOrderId] ?? null}
            />
          ) : null
        }
      />
    </div>
  )
}
