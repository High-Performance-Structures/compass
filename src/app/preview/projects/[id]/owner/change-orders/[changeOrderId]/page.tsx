export const dynamic = "force-dynamic"

import type * as React from "react"

import { ProjectAudienceChangeOrders } from "@/components/projects/project-audience-change-orders"

export default async function OwnerChangeOrderDetailPage({
  params,
}: {
  readonly params: Promise<{
    readonly id: string
    readonly changeOrderId: string
  }>
}): Promise<React.ReactElement> {
  const { id, changeOrderId } = await params
  return (
    <ProjectAudienceChangeOrders
      projectId={id}
      audience="owner"
      changeOrderId={changeOrderId}
    />
  )
}
