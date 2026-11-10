export const dynamic = "force-dynamic"

import { requireProjectRouteId } from "@/lib/project-route-id"
import type * as React from "react"

import { ProjectAudienceChangeOrders } from "@/components/projects/project-audience-change-orders"

export default async function OwnerChangeOrdersPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly id: string }>
  readonly searchParams: Promise<{ readonly item?: string | readonly string[] }>
}): Promise<React.ReactElement> {
  const { id: rawProjectId } = await params
  const query = await searchParams
  const openItemId = (Array.isArray(query.item) ? query.item[0] : query.item) ?? null
  const id = await requireProjectRouteId(rawProjectId)
  return <ProjectAudienceChangeOrders projectId={id} audience="owner" openItemId={openItemId} />
}
