export const dynamic = "force-dynamic"

import { requireProjectRouteId } from "@/lib/project-route-id"
import type * as React from "react"

import { ProjectAudienceChangeOrders } from "@/components/projects/project-audience-change-orders"

export default async function OwnerChangeOrdersPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}): Promise<React.ReactElement> {
  const { id: rawProjectId } = await params
  const id = await requireProjectRouteId(rawProjectId)
  return <ProjectAudienceChangeOrders projectId={id} audience="owner" />
}
