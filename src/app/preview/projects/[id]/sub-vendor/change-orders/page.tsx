export const dynamic = "force-dynamic"

import type * as React from "react"

import { ProjectAudienceChangeOrders } from "@/components/projects/project-audience-change-orders"

export default async function PartnerChangeOrdersPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}): Promise<React.ReactElement> {
  const { id } = await params
  return <ProjectAudienceChangeOrders projectId={id} audience="sub_vendor" />
}
