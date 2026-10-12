import { requireProjectRouteId } from "@/lib/project-route-id"
import type * as React from "react"

import { ProjectVendorWarranty } from "@/components/projects/project-vendor-warranty"

export const dynamic = "force-dynamic"

export default async function SubVendorWarrantyPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}): Promise<React.ReactElement> {
  const { id: rawProjectId } = await params
  const id = await requireProjectRouteId(rawProjectId)
  return <ProjectVendorWarranty projectId={id} />
}
