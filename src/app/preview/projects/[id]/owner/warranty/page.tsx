import type * as React from "react"

import { ProjectAudienceWarranty } from "@/components/projects/project-audience-warranty"

export const dynamic = "force-dynamic"

export default async function OwnerWarrantyPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}): Promise<React.ReactElement> {
  const { id } = await params
  return <ProjectAudienceWarranty projectId={id} />
}
