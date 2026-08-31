export const dynamic = "force-dynamic"

import { decodeProjectRouteId } from "@/lib/project-route-id"
import type * as React from "react"

import { ProjectAudienceChangeOrders } from "@/components/projects/project-audience-change-orders"

export default async function PartnerChangeOrdersPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}): Promise<React.ReactElement> {
  const { id: rawProjectId } = await params
  const id = decodeProjectRouteId(rawProjectId)
  return <ProjectAudienceChangeOrders projectId={id} audience="sub_vendor" />
}
